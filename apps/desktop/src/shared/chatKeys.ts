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

/** 与后端 `ConversationScopeKey.CHAT_KEY_MAX` 同一个数字，也是 `chat_conversation.chat_key` 的列宽。 */
export const CHAT_KEY_MAX = 128

// eslint-disable-next-line no-control-regex
const UNUSABLE = /[\s\x00-\x1f\x7f]/

/**
 * 「这个视图此刻正在看哪个会话」的唯一裁剪处。主进程四个出口共用它：翻译请求的盖章
 * （`webContentsView/ipc.ts:118`）、桥状态广播（`msgBridge/index.ts` 的 `bridgeStates()`，:80）、
 * 两条实时帧的 `activeChatKey`（同一文件 :171 的 message 帧、:194 的 send_result 帧）。
 * 四个出口只许读同一个 map、只许过同一道裁剪——留一处不过，下一个读者就得猜哪一份是权威的。
 *
 * 判定只做两件事：空白 / 含任何空白或控制符 / 超过 128 → `null`，其余**原样**。
 * 不 trim、不折叠大小写、不按后缀分平台——`scope_key` 与 `chat_key` 两列都是二进制比较，
 * 这里"顺手 normalize"一次，盖章处与入库处就差一个字符。
 *
 * 与 Java 那道闸是**成对的两份判定**：改这里的宽度或字符集，要同改 `ConversationScopeKey.rejectReason`。
 * 差别只朝安全方向开：JS 的 `\s` 认全角空格与 U+00A0，Java 的 `\s` 不认。
 * 于是这类键在页内会被丢掉（按钮不亮、翻译不带 chatKey），而直接打 HTTP 仍可写入。
 * 别反过来把这边放宽去对齐——那会打开"按钮点亮了但那条会话从没被采到过"的方向。
 */
export function activeChatKeyOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.length > CHAT_KEY_MAX) return null
  if (UNUSABLE.test(raw)) return null
  return raw
}
