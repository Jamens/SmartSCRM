// src/shared/msgIds.ts
/**
 * 平台裸消息 id（页内 `data-id` / wa-js `id.id`）能不能用来定位数据库那一行，判据只在这一个地方。
 *
 * 它与后端 `TranslationService.platformMsgId` 是**成对的两份判定**：改这里的宽度或字符集，
 * 要同改那一边。两边各判一遍是有意的——主进程这一层不合格就直接把键丢掉（请求照常翻，只是不参与
 * 消息级回显与回写），后端那一层是权威；谁单独放宽一边，另一边的假设就会静默失效。
 *
 * 挡掉的三类都不是"脏数据"而是**会放大匹配**的形状：后端那条 SQL 把 msgId 放进
 * `msg_key LIKE CONCAT('%', #{msgId})`，`%` 与 `_` 是 LIKE 的通配符、`\` 是它的转义符，
 * 三者会让"这一条消息"变成"该会话里任意一条消息"，进而把译文写进别人的行。
 * 空白与控制符一并挡：实形是十六进制一类的连续 token，带空格的必然是别的东西。
 */

/** 与后端 `chat_message.msg_id` 同宽，也与 `TranslateDTO.msgId` 的 `@Size` 同一个数字。 */
export const MSG_ID_MAX = 128

const VISIBLE_ASCII = /^[\x21-\x7e]+$/
const LIKE_METACHAR = /[%_\\]/

/** 合格返回原样（不 trim、不改大小写——两边都是二进制比较），不合格返回 `null`。 */
export function platformMsgIdOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.length > MSG_ID_MAX) return null
  if (!VISIBLE_ASCII.test(raw)) return null
  if (LIKE_METACHAR.test(raw)) return null
  return raw
}
