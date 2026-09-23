// src/shared/chatKeys.ts
/**
 * chat_key 形态的 TS 侧解释，与后端 `service/msg/ChatKeys.java`（Task 2）逐条同形。
 * 两份实现绕不开：桥与渲染层拿不到 Java，而"群判定"错了会让记录页把群当单聊（不显示发送人）、
 * 让「建为客户」给一个群建出一位不存在的客户。改这里必须同时改那一边——两边的用例钉的是同一批字面量。
 */
const WA_PEER = /^(\d{5,20})@(c\.us|lid|s\.wallet)$/

export function isGroupChatKey(chatKey: string | null | undefined): boolean {
  if (!chatKey) return false
  return chatKey.endsWith('@g.us') || chatKey.startsWith('-100') || chatKey.endsWith('@group')
}

/** 单聊对端的裸号码；群、Telegram 的一切、非数字形态都是 null。 */
export function peerPhoneOfChatKey(chatKey: string | null | undefined): string | null {
  if (!chatKey) return null
  const m = WA_PEER.exec(chatKey)
  return m ? m[1] : null
}
