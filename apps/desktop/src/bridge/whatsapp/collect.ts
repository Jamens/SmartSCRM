// src/bridge/whatsapp/collect.ts
import type { MsgStatus } from '../../shared/chatTypes.ts'
import { canAdvance, fromAck } from '../../shared/chatStatus.ts'
import type { CollectCtx, WaChatModel, WaMsgModel, WppLike } from '../types.ts'
import { normalizeWa, type NormalizeCtx } from './normalize.ts'

/** 会话之间至少隔 200ms：WhatsApp 页面在自己的主线程上跑，挤太狠会直接把界面卡住。 */
const CHAT_GAP_MS = 200
/** 单批取 50 条：与主进程 CollectorHub 的批量下限对齐，不在这层做大批。 */
const PAGE_SIZE = 50
/** 单次补底的会话数上限：先近后远，一次跑不完就等下一次按钮，别把页面钉死。 */
const MAX_CHATS_PER_RUN = 100

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function wpp(): WppLike | null {
  return typeof window !== 'undefined' && window.WPP ? window.WPP : null
}

/**
 * 实时事件。三件事：新消息、活动会话（决定未读数加不加）、ack 推进。
 * `canAdvance` 在这里先判一次，是为了不让"已读→已送达"这种倒退事件白跑一趟 IPC，
 * 真正的守卫仍在后端 SQL 里（两处同形由 Task 7 的同一组断言保证）。
 */
export function startLiveCollect(ctx: CollectCtx): () => void {
  const store = wpp()
  if (!store) return () => undefined
  const live: NormalizeCtx = { source: 'live' }
  const lastStatus = new Map<string, MsgStatus>()

  const subs = [
    store.on('chat.new_message', (msg: WaMsgModel) => {
      const row = normalizeWa(msg, live)
      if (!row) return
      if (row.status !== 'received') lastStatus.set(row.msgKey, row.status)
      ctx.emit({ kind: 'message', message: row })
    }),
    store.on('chat.msg_ack_change', (payload) => {
      const status = fromAck(payload.ack, 'out')
      // wa-js 4.6.0 复核（见 types.ts 注释）：一条 ack 事件携 `ids[]` 与消息所在会话 `chat`。
      // 带真 chatKey 上报，后端 advanceStatus 的 WHERE 钉着 chat_key，空串永远匹配不上。
      const chatKey = payload.chat?._serialized ?? ''
      for (const key of payload.ids ?? []) {
        const id = key?._serialized
        if (!id) continue
        const prev = lastStatus.get(id)
        if (prev && !canAdvance(prev, status)) continue
        lastStatus.set(id, status)
        ctx.emit({ kind: 'ack', chatKey, msgKey: id, status })
      }
    }),
    store.on('conn.logout', () => ctx.emit({ kind: 'logged_out' }))
  ]

  return () => {
    for (const s of subs) {
      try {
        s.off()
      } catch {
        /* 页面已经把钩子拆了：没什么可做的 */
      }
    }
  }
}

/** 活动会话：wa-js 4.x 没有稳定的 active_chat 事件名，这里用"命令驱动 + 事件（若有）"双轨。 */
export function reportActiveChat(ctx: CollectCtx): void {
  const store = wpp()
  const chat = store?.chat?.getActiveChat?.()
  ctx.emit({ kind: 'active_chat', chatKey: chat?.id?._serialized ?? null })
}

export function watchActiveChat(ctx: CollectCtx): () => void {
  const store = wpp()
  if (!store) return () => undefined
  let sub: { off(): void } | null = null
  try {
    sub = (store as unknown as {
      on(event: 'chat.active_chat', cb: (chat: WaChatModel | null) => void): { off(): void }
    }).on('chat.active_chat', (chat) => ctx.emit({ kind: 'active_chat', chatKey: chat?.id?._serialized ?? null }))
  } catch {
    sub = null
  }
  return () => sub?.off()
}

/**
 * 补底：每会话最近 limit 条，倒着翻页直到够数或没有更多。
 * 失败只跳过该会话并上报 `backfill_gap`——一个坏会话不该让整轮采集停住（spec §9）。
 */
export async function runBackfill(limit: number, ctx: CollectCtx): Promise<void> {
  const store = wpp()
  const chatApi = store?.chat
  if (!chatApi) {
    ctx.emit({ kind: 'backfill_gap', chatKey: '*', reason: 'WPP.chat 不可用' })
    return
  }
  const backfill: NormalizeCtx = { source: 'backfill' }
  let chats: WaChatModel[]
  try {
    chats = await chatApi.list({ page: 0, limit: MAX_CHATS_PER_RUN, onlyGroupChats: false })
  } catch (e) {
    ctx.emit({ kind: 'backfill_gap', chatKey: '*', reason: e instanceof Error ? e.message : String(e) })
    return
  }

  let messages = 0
  let done = 0
  for (const chat of chats) {
    const chatKey = chat.id?._serialized
    if (!chatKey || chat.archived === true) {
      done += 1
      continue
    }
    try {
      const collected: WaMsgModel[] = []
      let page = 0
      while (collected.length < limit) {
        const batch = await chatApi.getMessages(chatKey, { page, limit: PAGE_SIZE })
        if (!Array.isArray(batch) || batch.length === 0) break
        collected.push(...batch)
        page += 1
      }
      for (const raw of collected.slice(0, limit)) {
        const row = normalizeWa(raw, backfill)
        if (!row) continue
        row.chatTitle = chat.name ?? chat.formattedTitle
        ctx.emit({ kind: 'message', message: row })
        messages += 1
      }
    } catch (e) {
      ctx.emit({ kind: 'backfill_gap', chatKey, reason: e instanceof Error ? e.message : String(e) })
    }
    done += 1
    ctx.emit({ kind: 'backfill_progress', chatsDone: done, chatsTotal: chats.length, messages })
    await wait(CHAT_GAP_MS)
  }
}
