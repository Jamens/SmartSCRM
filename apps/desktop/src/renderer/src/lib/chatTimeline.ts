// src/renderer/src/lib/chatTimeline.ts
// 相对路径 + `.ts` 后缀是闸门要求的（与 `chatSearch.ts` / `chatDays.ts` 同一个写法）：本文件被 `node --test`
// 直接跑，Node 不认 `@shared/*` 别名——那一边只在 tsconfig 的 paths 里存在，编译绿、运行炸。
import { isGroupChatKey } from '../../../shared/chatKeys.ts'

/** `ConversationVO` 里时间线用到的那四个字段（闸门里不 import `@/api/messages`）。 */
export interface TimelineHead {
  accountId: number
  chatKey: string
  title: string | null
  isGroup: boolean
}

export interface TimelineGroup<T> {
  /**
   * 会话身份是 `(accountId, chatKey)` 而不是 `chatKey`：chat_key 只在一个账号内唯一
   * （`MessagesPage` 里归属判定那条注释钉的就是这条规则）。一位客户绑在两个 WhatsApp 账号上、
   * 两边都是同一个号码时，时间线会给出两条同 `chatKey` 的会话头——只按 `chatKey` 成组会把两个账号
   * 的消息混进同一张卡，而卡上那个「打开」按钮会跳到 `headOf` 里活下来的最后一条头上，
   * 用户看到的是一个账号的会话、点进去是另一个账号的线程，界面上没有任何痕迹。
   */
  accountId: number
  chatKey: string
  /** 会话头缺 title 时回落到 `chatKey` 的 `@` 前缀——与 `lib/chatDisplay.titleOfConversation` 同一条规则（那边引 `@/api/messages`，闸门里引不到，宁可写两遍也别把 react-query 拖进 node --test）。 */
  title: string
  isGroup: boolean
  /** 该卡里最后一条消息的时间：排序只看它，不看会话头的 `lastMsgTime`（那是投影值，可能比这批消息新）。 */
  lastTs: number
  rows: T[]
}

/**
 * 卡片身份 = 会话身份。唯一一份定义：`CustomerTimeline` 建 `headOf` 映射时要用它把会话头归到同一张卡，
 * 分隔符在两边各写一遍迟早分叉（分叉的表现是"跳转按钮永远找不到会话头，全灰掉"）。
 */
export const cardKey = (accountId: number, chatKey: string): string => `${accountId}|${chatKey}`

/**
 * 按 `(accountId, chatKey)` 切卡片。用 Map 而不是"相邻同键归并"：输入是后端的 `msg_time` 正序，
 * 但两条会话交错时相邻判等会把一条会话拆成好几张卡（第 4 条用例钉的就是这个）。
 */
export function groupByConversation<T extends { accountId: number; chatKey: string; ts: number }>(
  messages: readonly T[],
  heads: readonly TimelineHead[]
): TimelineGroup<T>[] {
  const headOf = new Map(heads.map((h) => [cardKey(h.accountId, h.chatKey), h]))
  const groups = new Map<string, TimelineGroup<T>>()
  for (const row of messages) {
    const key = cardKey(row.accountId, row.chatKey)
    let group = groups.get(key)
    if (!group) {
      const head = headOf.get(key)
      group = {
        accountId: row.accountId,
        chatKey: row.chatKey,
        title: head?.title?.trim() || row.chatKey.split('@')[0] || row.chatKey,
        // 单向抬高：形态能把 head 的 `isGroup=false` 纠正成 true（会话头没投影出来时最常见），
        // 反过来 head 说 true 而键是 `@c.us` 时信 head——投影值是后端按 `platform_type` 与 chat_key
        // 一起算的，形态只是兜底。
        isGroup: !!head?.isGroup || isGroupChatKey(row.chatKey),
        lastTs: row.ts,
        rows: []
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.ts > group.lastTs) group.lastTs = row.ts
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.ts - b.ts)
  return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs)
}
