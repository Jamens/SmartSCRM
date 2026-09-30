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
  /**
   * 群变动系统消息的判定字段（spec §4）。
   *
   * 这些字段**确实存在**——旧版已在真机跑通过这套解析（`gp2` + subtype 正则，目标人取
   * `recipients` / `recipientIds` / `participantIds` / `participants`）。但**取值形态待实测**
   * （spec §15#1）：subtype 的真实字面量、目标人是 Wid 对象还是裸字符串，都要一条真实加减人行本。
   * 所以这里声明成宽松的 unknown，由 shared 的分类器自己去掏，不假装已经知道形状。
   */
  subtype?: string
  participants?: unknown
  participantIds?: unknown
  recipients?: unknown
  recipient?: string | WaWid
  participant?: string | WaWid
  isNotification?: boolean
  isGroupNotification?: boolean
}

export interface WaChatModel {
  id?: { _serialized?: string }
  name?: string
  /** 自聊与 @lid 会话的 name 是空的，显示名只在这个字段上（2026-09-22 真实登录态实测）。 */
  formattedTitle?: string
  isGroup?: boolean
  archived?: boolean
  /**
   * 群元数据的**副源**（spec §4）：`WPP.chat.get(id).groupMetadata.participants`。
   * 主源 `WPP.group.getParticipants` 漏掉的人靠它补，但它给不出进群时间，所以只能补漏不能改写。
   */
  groupMetadata?: { participants?: WaParticipant[] }
}

/**
 * wa-js 4.6.0 的 `ParticipantModel` 只有这三个字段可用
 * （`dist/whatsapp/models/ParticipantModel.d.ts:17-27`：`id / isAdmin / isSuperAdmin`
 * 加几个 session 位）。**没有任何进群时间**——这正是"快照定谁在群、事件定何时"的由来。
 */
export interface WaParticipant {
  id?: WaWid
  isAdmin?: boolean
  isSuperAdmin?: boolean
}

/**
 * `group.participant_changed` 的载荷（wa-js 4.6.0 `dist/group/events/eventTypes.d.ts`）。
 *
 * 注意 `action` 里没有 'removed'/'added'，是 'add'/'remove'/'leaver'/'join'；
 * 到本项目 event_type 的映射在 shared/groupMembers.ts 的 `eventTypeFromAction`，不在桥这一侧。
 */
export interface WaGroupParticipantChanged {
  author?: string
  authorPushName?: string
  groupId: string
  action: 'add' | 'remove' | 'demote' | 'promote' | 'leaver' | 'join'
  operation?: number
  /** 目标人。一次群变动可以有多个人，所以是数组。 */
  participants?: string[]
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

/**
 * `deleteMessage` 的返回体（wa-js 4.6.0 `dist/chat/functions/deleteMessage.d.ts` 的
 * `DeleteMessageReturn`）：三个布尔里只有 `isRevoked` 表示"对所有人撤回"成了，`isDeleted`
 * 只说明本机那条没了——判定语义在 `whatsapp/recall.ts`，这里只声明形状。
 * 类型在本文件唯一声明，叶子模块 `recall.ts` 取别名，不另抄一份字段。
 */
export interface WaDeleteResult {
  id?: string
  sendMsgResult?: unknown
  isRevoked?: boolean
  isDeleted?: boolean
  isSentByMe?: boolean
}

export interface WppChatApi {
  list(options: Record<string, unknown>): Promise<WaChatModel[]>
  getMessages(chatId: string, options: Record<string, unknown>): Promise<WaMsgModel[]>
  getActiveChat(): { id?: { _serialized?: string } } | null
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
  /** 同步返回群/会话模型；拿 `groupMetadata` 副源用。`WPP.chat.get` 在 wa-js 里是同步的。 */
  get(chatId: string): WaChatModel | undefined
  /** `ids` 按 wa-js 文档收 string 或 string[]，桥这一侧只传一条裸 key（去 `_out` 尾在 recall.ts）。 */
  deleteMessage(chatId: string, ids: string, deleteMediaInDevice?: boolean, revoke?: boolean): Promise<WaDeleteResult>
}

/** `WPP.group`：签名按 wa-js 4.6.0 的 `dist/group/functions/*.d.ts` 逐个核对过。 */
export interface WppGroupApi {
  /** `getAllGroups()`：注意返回数组里可能有 `undefined` 项，必须过滤（wa-js 的声明就是联合 undefined）。 */
  getAllGroups(): Promise<Array<WaChatModel | undefined>>
  /** `getParticipants(groupId)`：快照主源。超大群是否分页截断**未实测**（spec §15#3）。 */
  getParticipants(groupId: string): Promise<WaParticipant[]>
}

/** `WPP.contact`：只用来补成员的手机号与显示名，取不到就留空，不猜。 */
export interface WppContactApi {
  get(id: string): { id?: WaWid; name?: string; pushname?: string; formattedName?: string } | undefined
}

export interface WppLike {
  isReady?(): boolean
  chat?: WppChatApi
  group?: WppGroupApi
  contact?: WppContactApi
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
  /**
   * 群成员变动（spec §4）。桥只做"转译 + 上报"，判定一律走 shared 的纯函数。
   * 这个事件**不带发生时间**，所以 `occurredAtEpochSec` 取的是到达时刻（spec §15#5）。
   */
  on(
    event: 'group.participant_changed',
    cb: (payload: WaGroupParticipantChanged) => void
  ): { off(): void }
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
