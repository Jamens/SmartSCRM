// src/renderer/src/lib/chatTimeline.ts
// 相对路径 + `.ts` 后缀是闸门要求的（与 `chatSearch.ts` / `chatDays.ts` 同一个写法）：本文件被 `node --test`
// 直接跑，Node 不认 `@shared/*` 别名——那一边只在 tsconfig 的 paths 里存在，编译绿、运行炸。
import { isGroupChatKey } from '../../../shared/chatKeys.ts'

/** `ConversationVO` 里时间线用到的那三个字段（闸门里不 import `@/api/messages`）。 */
export interface TimelineHead {
  chatKey: string
  title: string | null
  isGroup: boolean
}

export interface TimelineGroup<T> {
  chatKey: string
  /** 会话头缺 title 时回落到 `chatKey` 的 `@` 前缀——与 `lib/chatDisplay.titleOfConversation` 同一条规则（那边引 `@/api/messages`，闸门里引不到，宁可写两遍也别把 react-query 拖进 node --test）。 */
  title: string
  isGroup: boolean
  /** 该卡里最后一条消息的时间：排序只看它，不看会话头的 `lastMsgTime`（那是投影值，可能比这批消息新）。 */
  lastTs: number
  rows: T[]
}

/**
 * 按 `chatKey` 切卡片。用 Map 而不是"相邻同键归并"：输入是后端的 `msg_time` 正序，
 * 但两条会话交错时相邻判等会把一条会话拆成好几张卡（第 4 条用例钉的就是这个）。
 */
export function groupByConversation<T extends { chatKey: string; ts: number }>(
  messages: readonly T[],
  heads: readonly TimelineHead[]
): TimelineGroup<T>[] {
  const headOf = new Map(heads.map((h) => [h.chatKey, h]))
  const groups = new Map<string, TimelineGroup<T>>()
  for (const row of messages) {
    let group = groups.get(row.chatKey)
    if (!group) {
      const head = headOf.get(row.chatKey)
      group = {
        chatKey: row.chatKey,
        title: head?.title?.trim() || row.chatKey.split('@')[0] || row.chatKey,
        isGroup: head ? head.isGroup || isGroupChatKey(row.chatKey) : isGroupChatKey(row.chatKey),
        lastTs: row.ts,
        rows: []
      }
      groups.set(row.chatKey, group)
    }
    group.rows.push(row)
    if (row.ts > group.lastTs) group.lastTs = row.ts
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.ts - b.ts)
  return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs)
}
