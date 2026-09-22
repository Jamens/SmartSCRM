// src/renderer/src/lib/chatDisplay.ts
import dayjs from 'dayjs'
import type { ConversationVO } from '@/api/messages'

/**
 * 没有 title 时至少让人认得出这是谁：chat_key 的 `@c.us` / `@telegram` 后缀
 * 对销售没有信息量，取前缀（手机号或群 id）。
 */
export function titleOfConversation(c: Pick<ConversationVO, 'title' | 'chatKey'>): string {
  if (c.title) return c.title
  return c.chatKey.split('@')[0] ?? c.chatKey
}

/** 气泡里的时刻：日分组已经交代了"哪天"，这里只到分。 */
export function timeOfMessage(ts: number): string {
  return dayjs(ts).format('HH:mm')
}
