// src/bridge/types.ts
import type { BridgeReport } from '../shared/chatTypes.ts'

/**
 * 桥运行在用户正在看的 WhatsApp 页面里，能拿到的只有 wa-js 挂在 `window.WPP` 上的东西。
 * 这里只声明桥真正读到的字段子集：wa-js 升级时编译不会假绿，
 * 但运行期的探测（`ready` 握手 + 心跳）会立刻把它打成 retry，而不是静默采不到。
 */
export interface WaMsgId {
  _serialized?: string
  id?: string
  from?: string
  clientUrl?: string
  /** wa-js 4.6.0 实测：`getMessages` 返回的行没有顶层 `isFromMe`，方向只在 `id.fromMe`。 */
  fromMe?: boolean
}

/** Wid 对象（`{ user, server, _serialized }`）：2026-09-21 真实登录态实测 `from`/`to` 给的是它，不是字符串。 */
export interface WaWid {
  _serialized?: string
}

export interface WaMsgModel {
  id?: WaMsgId
  body?: string
  type?: string
  /** unix 秒。缺失 / 0 / 未来值都不在这里钳制，交给后端 MsgTimes（收敛 #9）。 */
  t?: number
  /** 字符串（事件流里部分形态）或 Wid 对象（`chat.getMessages` 实测形态），归一化两处都吃。 */
  from?: string | WaWid
  to?: string | WaWid
  author?: string | WaWid
  isFromMe?: boolean
  ack?: number
  chatId?: { _serialized?: string }
  isNewMsg?: boolean
  /** 群里/单聊对方显示名，落 `sender_name`。 */
  notifyName?: string
  /** 媒体摘要用到的可选字段：有就用，没有就落回类型占位。 */
  caption?: string
  filename?: string
  mimetype?: string
  formattedTitle?: string
  loc?: string
  locName?: string
  contact?: { name?: string }
}

export interface WaChatModel {
  id?: { _serialized?: string }
  name?: string
  /** 自聊与 @lid 会话的 name 是空的，显示名只在这个字段上（2026-09-22 真实登录态实测）。 */
  formattedTitle?: string
  isGroup?: boolean
  archived?: boolean
}

/**
 * wa-js 4.6.0 的类型与真机一致（`dist/chat/types.d.ts` 的 `SendMessageReturn`）：`sendTextMessage`
 * 结的不是 MsgModel，而是 `{ id, from, to, ack, sendMsgResult }`，且 **`id` 是序列化字符串**
 * （`true_<chatKey>_<ID>_out`，自带 `_out` 后缀）。按 `id._serialized` 取值会静默拿到 undefined，
 * 于是每次真发送都被判成"平台未返回 msgKey"。`sendMsgResult` 在不带 `waitForAck` 时恒为 null。
 */
export interface SendChatResult {
  id?: string
  ack?: number
  sendMsgResult?: unknown
}

export interface WppChatApi {
  list(options: Record<string, unknown>): Promise<WaChatModel[]>
  getMessages(chatId: string, options: Record<string, unknown>): Promise<WaMsgModel[]>
  getActiveChat(): { id?: { _serialized?: string } } | null
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
}

export interface WppLike {
  isReady?(): boolean
  chat?: WppChatApi
  /**
   * 事件名与签名按 wa-js 4.x：返回值带 off()。
   * 已按 `dist/chat/events/eventTypes.d.ts`（wa-js 4.6.0）复核：
   * `chat.msg_ack_change` 的真实载荷是 `{ ack, chat, ids[] }`——一条事件可携多条 msgKey，
   * 并带着消息所在会话的 chat，页内因此能给出真 chatKey，不必让主进程空串反查。
   */
  on(event: 'chat.new_message', cb: (msg: WaMsgModel) => void): { off(): void }
  on(event: 'chat.active_chat', cb: (chat: WaChatModel | null) => void): { off(): void }
  on(
    event: 'chat.msg_ack_change',
    cb: (payload: { ack: number; chat?: { _serialized?: string }; ids?: { _serialized?: string }[] }) => void
  ): { off(): void }
  on(event: 'conn.logout', cb: () => void): { off(): void }
}

declare global {
  interface Window {
    WPP?: WppLike
  }
}

/** 页内采集层唯一的对外依赖：把上报交回桥，不碰 IPC、不碰后端。 */
export interface CollectCtx {
  emit: (report: BridgeReport) => void
}

/**
 * 四入口的签名。命名按 WhatsApp 那一支已有的实现，Telegram 补齐同名四项即可登记；
 * 少任何一项都不算一个合法实现——登记进查表后 TS 会直接报错，而不是运行时静默少一路。
 */
export interface CollectImpl {
  startLiveCollect(ctx: CollectCtx): () => void
  watchActiveChat(ctx: CollectCtx): () => void
  reportActiveChat(ctx: CollectCtx): void
  runBackfill(limit: number, ctx: CollectCtx): Promise<void>
}
