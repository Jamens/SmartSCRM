// src/shared/msgIds.ts
/**
 * 平台裸消息 id（页内 `data-id` / wa-js `id.id`）能不能用来定位数据库那一行，判据只在这一个地方。
 *
 * 它与后端 `TranslationService.platformMsgId` 是**成对的两份判定**：改这里的宽度或字符集，
 * 要同改那一边。两边各判一遍是有意的——主进程这一层不合格就直接把键丢掉（请求照常翻，只是不参与
 * 消息级回显与回写），后端那一层是权威；谁单独放宽一边，另一边的假设就会静默失效。
 *
 * 挡掉的三类都不是"脏数据"而是**会放大匹配**的形状：后端那两条 SQL（`ChatMessageMapper` 的
 * `findForTranslationByMsgKeyTail`：`msg_key LIKE CONCAT('%', #{msgId})` 与
 * `... LIKE CONCAT('%\_', #{msgId}, '\_out')`）把 msgId 拼进 LIKE 模式里，`%` 与 `_` 是 LIKE 的通配符、
 * `\` 是它的转义符，三者会让"这一条消息"变成"该会话里任意一条消息"，进而把译文写进别人的行。
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

/** 发出行的序列化键多出的那一段尾（wa-js 给 `id._serialized` 的形态，不是本仓库加的）。 */
const OUTGOING_SUFFIX = '_out'

/** WA 的 `_serialized` 以归属打头：这一格既是形状说明，也是"别把别的平台的键切一刀当 id"的闸。 */
const SERIALIZED_PREFIX = /^(?:true|false)_/

/**
 * 从序列化的 `msgKey`（`<fromMe>_<chatKey>_<id>[_out]`）里取出裸平台消息 id。
 *
 * 存在的理由只有一格：主进程自己发出去的那条消息（`send_result` 补写的行）手里只有
 * 平台回执给的 `_serialized` 串，没有 `id.id`，而后端按消息定位要用后者。
 * 采集链不需要它——wa-js 事件流直接给 `id.id`（`bridge/whatsapp/normalize.ts`）。
 *
 * 取法是把形状反过来走一遍：认得 `<true|false>_` 前缀才往下切（不认得就回 `null`，
 * 免得把别的平台的键按 `_` 切出一个假 id 存进 `msg_id`），再去掉发出行那一段 `_out` 尾，
 * 最后取末段。不按第一段切，因为 `chatKey` 自己含 `@` 与 `-`、也可能含 `_`。
 * 按末段切成立的**前提**是平台 id 不含 `_`（WA 的 `id.id` 是十六进制 token，成立）。前提哪天破了，
 * 末段会截出一截短后缀，而尾部模式 `%<后缀>` 能匹配到同会话里所有以那截后缀结尾的行——
 * 挡住"把译文写进别人的行"的是服务层那一次 `body` 逐字比对（对不上就当没定位到），不是这里的形状检查。
 * 于是这里宁可回 `null`：形状对不上就当这条没有裸 id，行照样入库，只是那一行要靠
 * `msg_key` 尾部的 `_out` 模式才被后端认出来。
 */
export function msgIdOfSerializedKey(msgKey: string | null | undefined): string | null {
  if (!msgKey || !SERIALIZED_PREFIX.test(msgKey)) return null
  const withoutSuffix = msgKey.endsWith(OUTGOING_SUFFIX)
    ? msgKey.slice(0, -OUTGOING_SUFFIX.length)
    : msgKey
  const at = withoutSuffix.lastIndexOf('_')
  if (at < 0 || at === withoutSuffix.length - 1) return null
  return platformMsgIdOf(withoutSuffix.slice(at + 1))
}
