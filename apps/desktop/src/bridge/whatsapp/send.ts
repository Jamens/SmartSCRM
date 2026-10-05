// src/bridge/whatsapp/send.ts
import type {
  BridgeCommand,
  ButtonSpec,
  SendError,
  SendReceipt
} from '../../shared/chatTypes.ts'
import type { SendChatResult } from '../types.ts'

export type SendCmd = Extract<BridgeCommand, { kind: 'send' }>

/** 只依赖发送这一件事，测试用假对象即可，不需要真的 WPP。 */
export interface SendChat {
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
}

/**
 * 把归一化的 `ButtonSpec[]` 翻成 wa-js `sendTextMessage(..., { buttons })` 认的形状。
 * wa-js 的 `buttons` 选项按字段区分类型（不是按 `type` 字段）：
 * reply→`{ id, text }`、url→`{ url, text }`、call→`{ phoneNumber, text }`。
 * `copy` 在 wa-js 没有原生对应（它会把 `id` 当 quick-reply 处理），按 reply 兜底——
 * 这是发送侧的最佳努力，已在后端 `MaterialButtons` 注释里声明过 wa-js 的能力边界。
 * `title`/`footer` 走选项同名字段，由调用方（渲染层解析 `buttonPayload`）塞进 `cmd.text` 与这里无关。
 */
export function toWaButtons(buttons: ButtonSpec[]): Record<string, unknown>[] {
  return buttons.map((b) => {
    const out: Record<string, unknown> = { text: b.text }
    switch (b.type) {
      case 'url':
        out.url = b.value ?? ''
        break
      case 'call':
        out.phoneNumber = b.value ?? ''
        break
      default:
        // reply 与 copy 都落到 `id`：copy 是兜底（wa-js 无原生 copy 按钮）。
        out.id = b.value ?? ''
    }
    return out
  })
}

/**
 * 错误码分类。wa-js 抛的是普通 Error，文案随版本变，所以这里只是尽力归类：
 * 认不出一律 SEND_FAILED。真实分类词在真机"坏 chatKey"那一档实测，不符就回来补正则。
 */
export function classify(err: unknown): SendError {
  const text = err instanceof Error ? err.message : String(err)
  return /chat|recipient|participant|number|not found|invalid|404|cannot send/i.test(text)
    ? 'CHAT_NOT_FOUND'
    : 'SEND_FAILED'
}

/**
 * 回执里的 key **原样用**，不去 `_out` 后缀、不剥前缀：这一串要与事件流那条的
 * `MsgModel.id._serialized` 逐字相等，后端 `uk_msg` 才认得出是同一行（主进程的归属登记与
 * 补写全靠这一致性）。去尾只属于页内 API 的入参（`deleteMessage` 要的是去掉 `_out` 的那串）。
 */
export function receiptFrom(cmd: SendCmd, result: SendChatResult | null | undefined, err: unknown): SendReceipt {
  if (err) {
    return {
      localId: cmd.localId,
      ok: false,
      error: classify(err),
      detail: err instanceof Error ? err.message : String(err)
    }
  }
  const msgKey = result?.id ?? ''
  // 没有 msgKey 就当失败：主进程无法把这一行与 localId 关联，成功返回只会造出一条查不到的幽灵气泡。
  if (!msgKey) return { localId: cmd.localId, ok: false, error: 'SEND_FAILED', detail: '平台未返回 msgKey' }
  return { localId: cmd.localId, ok: true, msgKey }
}

/**
 * `waitForAck: false`——回执要快，状态推进交给 ack 事件流（Task 11 的 msg_ack_change）。
 * 选项名以 Step 1 的 grep 结果为准。
 */
export async function sendViaWa(cmd: SendCmd, chat: SendChat | undefined): Promise<SendReceipt> {
  if (!chat) return { localId: cmd.localId, ok: false, error: 'BRIDGE_OFFLINE', detail: 'WPP.chat 不可用' }
  try {
    const options: Record<string, unknown> = { createChat: true, waitForAck: false }
    // 条件追加：无按钮时 options 必须**保持** `{ createChat, waitForAck }` 这一份，
    // 否则既有的 `send.test.ts` / `index.test.ts` 三元组断言会整组挂掉（那两条断言证的就是"纯文本"形状）。
    // 按钮是附加能力，绝不能污染普通文本消息的选项对象。
    if (cmd.buttons && cmd.buttons.length > 0) {
      options.buttons = toWaButtons(cmd.buttons)
    }
    const result = await chat.sendTextMessage(cmd.chatKey, cmd.text, options)
    return receiptFrom(cmd, result, null)
  } catch (e) {
    return receiptFrom(cmd, null, e)
  }
}
