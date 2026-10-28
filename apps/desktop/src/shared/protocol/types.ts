// src/shared/protocol/types.ts
// WA 协议号（B27）通道：渲染进程直连外部 protocol 网关（REST + WS）。
// 类型与网关契约一一对应（2026-10-02 核定，契约要点见 README §7）。
// 本文件只放纯类型与常量，不依赖任何浏览器 API，便于 node --test 覆盖。

import type { MediaType, MsgSource, MsgStatus } from '../chatTypes.ts'

// ---------------------------------------------------------------------------
// 协议源（B27 WA 协议号 / 本 spec 的 TG 协议源）
// ---------------------------------------------------------------------------

/** 外部协议源。'wa-protocol' = B27 WA 协议号；'telegram' = TG 协议源。 */
export type ProtocolSource = 'wa-protocol' | 'telegram'
/** 缺省源：既有的 WA 协议号链路。不给 source 的调用点行为与改造前完全一致。 */
export const DEFAULT_PROTOCOL_SOURCE: ProtocolSource = 'wa-protocol'

/** 一个要接进同步管理的协议源账号：`accountId` + 它属于哪个源。 */
export interface ProtocolSourceEntry {
  accountId: number
  source: ProtocolSource
}

// ---------------------------------------------------------------------------
// WS 信封与网关 payload
// ---------------------------------------------------------------------------

/** WS 下一帧的包络：事件名在 event，载荷在 data。PING/PONG 走裸 socket 字符串，不进这个结构。 */
export interface ProtocolWsEnvelope<T = unknown> {
  event?: string
  timestamp?: number
  data?: T
}

// TG 协议源复用本结构（R8：字段名沿用 wp 前缀，一个字不改）。下面四项的 TG 真实形状
// **形态待实测**（R7，期二拿到账号后逐条回填；现在只留注释，不加字段、不写死逻辑）：
// 1. msgType：WA 是 1-7/99 的数值域，TG 预期是名称域（photo/voice/animation/video_note…），
//    真实取值域未验证 → 见 normalize.ts 的 tgMsgTypeToMediaType（未知一律回落 text）。
// 2. 时间戳：TG 给的是否为 epoch 秒、落在 waTimestamp 还是 createdAt，未验证 →
//    归一化仍按既有的 `waTimestamp ?? createdAt` 优先级取（normalize.ts）。
// 3. senderJid：TG 的发送人是否带 `user#id` 形态（而非 WA 的 `xxx@c.us`），未验证 →
//    按原样透传成 senderKey，不做解析。
// 4. 已读回执：TG 是否有与 WA_MSG_STATUS_PUSH 等价的已读事件，未验证 →
//    TG 侧暂只用 TG_MSG_STATUS_PUSH，其 status 取值域同样待实测。
/** WA_MSG_IN_PUSH.data —— 一条入站/出站消息（RocketMQ wa_msg_in_push）。 */
export interface ProtocolInboundMessage {
  schemaVersion?: string
  businessId?: number
  accountId?: number
  userId?: number
  conversationId?: number
  conversationType?: number
  messageId?: number
  /** 0 收 / 1 发（msg_from）。 */
  from?: number
  /** 对端（会话）JID，即 chat_key；单聊=对方，群聊=群 JID。 */
  peerJid?: string
  senderJid?: string
  senderName?: string
  /** 1文本/2图片/3视频/4音频/5文档/6贴纸/7位置/99未知。 */
  msgType?: number | string
  content?: ProtocolMessageContent
  createdAt?: string
  edited?: number
  editedAt?: string
  /** WhatsApp 侧时间（epoch 秒字符串或 ISO），展示与分组以此为准。 */
  waTimestamp?: string
  /** WhatsApp 消息 id（幂等键候选）。 */
  wpMsgId?: string
  /** 客户端幂等键（出站发送时由发起方带）。 */
  clientMsgId?: string
  /** 0-6 或枚举名（见 wpStatusToMsgStatus）。 */
  status?: number | string
  senderType?: number
  senderPhone?: string
}

export interface ProtocolMessageContent {
  fileName?: string
  mediaId?: number
  mediaUrl?: string
  mimeType?: string
  /** 文本正文；媒体类表示说明文字，可空。 */
  text?: string
  size?: number
  width?: number
  height?: number
  durationSeconds?: number
  preview?: string
}

/** WA_MSG_STATUS_PUSH.data —— 一批状态更新（RocketMQ wa_msg_status_push）。注意：没有 chatKey，只有 conversationId + messageId。 */
export interface ProtocolStatusPush {
  schemaVersion?: string
  businessId?: number
  accountId?: number
  userId?: number
  phone?: string
  timestamp?: number
  conversationId?: number
  /** 与入站 messageId 同键，用于匹配落库 msgKey。 */
  messageId?: number
  status?: number | string
  createdAt?: string
  changedAt?: string
}

/** WA_ACCOUNT_STATUS_PUSH.data —— 账号在线/异常/登出/封禁（0在线/1异常/2登出/3封禁）。 */
export interface ProtocolAccountStatusPush {
  schemaVersion?: string
  businessId?: number
  userId?: number
  accountId?: number
  status?: number
  changedAt?: string
}

/** WS 事件名。网关还会推别的事件，这条通道只消费 WA_* 四个；TG 源另用 TG_* 三个（下方追加，既有条目不动）。 */
export const PROTOCOL_WS_TYPES = {
  MSG_IN: 'WA_MSG_IN_PUSH',
  MSG_STATUS: 'WA_MSG_STATUS_PUSH',
  ACCOUNT_STATUS: 'WA_ACCOUNT_STATUS_PUSH',
  KICK_OUT: 'KICK_OUT',
  // TG 协议源（期一）：与 WA_* 一一对应，只是事件名分开——网关侧与排障日志要能一眼看出源（D1）。
  // 信封形状、PING/PONG、关闭码语义全部沿用 WA，一个字都没改（R2）。
  TG_MSG_IN: 'TG_MSG_IN_PUSH',
  TG_MSG_STATUS: 'TG_MSG_STATUS_PUSH',
  TG_ACCOUNT_STATUS: 'TG_ACCOUNT_STATUS_PUSH'
} as const

/** 鉴权失败：刷新 token 后重试（关闭码 4001–4004）。 */
export const AUTH_CLOSE_CODES = new Set([4001, 4002, 4003, 4004])
/** 硬停：被踢/被封，不重连（关闭码 4005/4007）。 */
export const STOP_RECONNECT_CODES = new Set([4005, 4007])

/** 心跳间隔（ms）。 */
export const WS_PING_INTERVAL_MS = 30_000
/** 心跳是裸 socket 字符串（非 JSON），不是 `{event,data}` 帧。 */
export const WS_PING_FRAME = 'PING'
export const WS_PONG_FRAME = 'PONG'
export const WS_ECHO_REPLY_FRAME = 'ECHO_REPLY'

// ---------------------------------------------------------------------------
// 落库 DTO（字段与后端 MessageItemDTO / MessageStatusDTO 逐字一致）
// ---------------------------------------------------------------------------

/** 落库用的单条消息。 */
export interface IngestMessage {
  chatKey: string
  msgKey: string
  msgId?: string
  direction: 'in' | 'out'
  senderKey?: string
  senderName?: string
  body?: string | null
  mediaType: MediaType
  mediaSummary?: string | null
  msgTimeEpochSec: number
  status: MsgStatus
  source: MsgSource
  sendLocalId?: string
  chatTitle?: string
}

export interface IngestBatch {
  accountId: number
  activeChatKey?: string | null
  messages: IngestMessage[]
}

export interface IngestStatusUpdate {
  msgKey: string
  status: MsgStatus
}

export interface IngestStatus {
  accountId: number
  chatKey: string
  updates: IngestStatusUpdate[]
}
