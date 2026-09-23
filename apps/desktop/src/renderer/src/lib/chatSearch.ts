// src/renderer/src/lib/chatSearch.ts
import dayjs from 'dayjs'
// 相对路径 + `.ts` 后缀是闸门要求的（与 `chatDays.ts` 同一个写法）：本文件被 `node --test` 直接跑，
// Node 不认 `@shared/*` 别名——那一边只在 tsconfig 的 paths 里存在。
import { isGroupChatKey } from '../../../shared/chatKeys.ts'
import type { ChatPlatform } from '@shared/chatPlatform'

/** 搜索结果点进来之后高亮停留多久（spec §8「锚定高亮 2s」）。 */
export const HIGHLIGHT_MS = 2_000

/**
 * 起搜的最少字符数，**界面提示与 `useSearchMessages` 的 `enabled` 共用这一个值**：两边各写一份字面量时，
 * 改一处就成了"写着要两个字、一个字就发请求"或反过来永远不发。放在这里而不是 `api/messages.ts`，是因为
 * 本文件不 import 任何 react-query 的东西（闸门里跑得了），依赖方向只允许 `api → lib`，反过来会把
 * `chatSearch` 拖出 `node --test`。
 */
export const MIN_QUERY = 2

/**
 * 只声明用得到的字段：`api/messages.ts` 连着 react-query 与 `@/lib/http`，一旦被闸门里的
 * 文件 import，`node --test` 就得去解析整套渲染层依赖，而 `tsconfig.unit.json` 里没有 `@/*` 别名。
 * TS 是结构类型，真实 VO 赋给这些窄形状天然成立——两侧的字段名由 Task 4 / Task 13 钉着。
 */
export interface HitMessageShape {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  msgKey: string
  msgTime: string
  customerId: number | null
}

export interface HitShape {
  message: HitMessageShape
  conversationId: number | null
  chatTitle: string | null
}

/** 与 Task 13 的 `ConversationVO` 逐字同形（`lastMsgTime` 在这里必然是 null：命中不是会话头）。 */
export interface JumpConversation {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  title: string | null
  isGroup: boolean
  customerId: number | null
  lastMsgTime: null
  lastMsgBody: null
  unreadCount: number
}

export interface JumpTarget {
  conversation: JumpConversation
  /** `chatKey` 是防御字段：锚点跟着会话走，不带它就识不破"切了会话却留着旧锚点"。 */
  anchor: { msgKey: string; messageId: number; chatKey: string; label: string }
}

/** 定位条上那句人话：今年内省掉年份，跨年补上——与 `chatDays.dayLabel` 同一套读法。 */
export function anchorLabel(ts: number, nowMs: number = Date.now()): string {
  const target = dayjs(ts)
  return target.year() === dayjs(nowMs).year()
    ? target.format('M月D日 HH:mm')
    : target.format('YYYY年M月D日 HH:mm')
}

/**
 * 一条搜索结果 → "跳进哪个会话、锚在哪一条"。返回 null 只有一种情况：命中消息有、会话头没有
 * （Task 4 的 `headsOf` 允许 null）。这时候不跳——右列保持原样，卡片自己显示"无法跳转"，
 * 比跳过去对着一个空白窗口好解释。
 */
export function jumpToOfHit(hit: HitShape): JumpTarget | null {
  if (hit.conversationId === null) return null
  const m = hit.message
  return {
    conversation: {
      id: hit.conversationId,
      accountId: m.accountId,
      platform: m.platform,
      chatKey: m.chatKey,
      title: hit.chatTitle,
      isGroup: isGroupChatKey(m.chatKey),
      customerId: m.customerId,
      lastMsgTime: null,
      lastMsgBody: null,
      unreadCount: 0
    },
    anchor: {
      msgKey: m.msgKey,
      messageId: m.id,
      chatKey: m.chatKey,
      label: anchorLabel(dayjs(m.msgTime).valueOf())
    }
  }
}
