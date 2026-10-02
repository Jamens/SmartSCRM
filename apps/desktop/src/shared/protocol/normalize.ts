// src/shared/protocol/normalize.ts
// 网关消息 -> 后端 ingest DTO 的纯归一化。无副作用、可单测。
//
// 字段映射按网关契约（见 @shared/protocol/types.ts 与 README §7）：
// - chat_key 取 peerJid（对端/会话 JID，形如 1xx@g.us / 1xx@c.us）
// - msg_key 取 messageId（与状态推送同键，保证 WA_MSG_STATUS_PUSH 能对上）
// - direction 由 from（0收/1发）决定
// - mediaType 由 msgType 数值/字符串映射
// - status 由网关 0-6 码或枚举名映射（Revoked 归 failed）
// - msgTimeEpochSec 由 waTimestamp/createdAt（epoch 秒串或 ISO）换算
// 网关真实 payload schema 已确认；其余字段透明透传。

import type { MediaType, MsgStatus, MsgSource } from '../chatTypes.ts'
import type {
  ProtocolInboundMessage,
  IngestMessage,
  IngestStatus,
  IngestStatusUpdate
} from './types.ts'

const STATUS_BY_CODE: Record<number, MsgStatus> = {
  0: 'pending',
  1: 'pending', // SENDING -> 无对应枚举，归 pending
  2: 'sent',
  3: 'delivered',
  4: 'read',
  5: 'failed',
  6: 'failed' // REVOKED -> 协议号无撤回面，归 failed
}
const STATUS_BY_NAME: Record<string, MsgStatus> = {
  PENDING: 'pending',
  SENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  REVOKED: 'failed'
}

/** 网关 msgType 数值/字符串 -> 我们统一的 MediaType。未知/缺省按文本。 */
export function wpMsgTypeToMediaType(msgType?: number | string): MediaType {
  if (msgType == null) return 'text'
  const map: Record<string, MediaType> = {
    '1': 'text',
    '2': 'image',
    '3': 'video',
    '4': 'audio',
    '5': 'document',
    '6': 'sticker',
    '7': 'location',
    '99': 'unknown',
    text: 'text',
    image: 'image',
    video: 'video',
    audio: 'audio',
    document: 'document',
    sticker: 'sticker',
    location: 'location',
    unknown: 'unknown'
  }
  return map[String(msgType).toLowerCase()] ?? 'text'
}

/** 网关状态（0-6 或枚举名）-> 我们统一的 MsgStatus。Revoked 归 failed；空值返回 undefined。 */
export function wpStatusToMsgStatus(status?: number | string | null): MsgStatus | undefined {
  if (status == null || status === '') return undefined
  if (typeof status === 'number' || /^\d+$/.test(String(status))) {
    return STATUS_BY_CODE[Number(status)]
  }
  const key = String(status).toUpperCase()
  return STATUS_BY_NAME[key] ?? undefined
}

/** WA 时间（epoch 秒字符串 / ISO / 数字）-> epoch 秒数字。缺省回退当前时间（后端要求非空）。 */
export function toEpochSec(value?: string | number | null): number {
  if (value == null || value === '') return Math.floor(Date.now() / 1000)
  if (typeof value === 'number') return value
  const s = String(value).trim()
  if (/^\d+$/.test(s)) return Number(s)
  const parsed = Date.parse(s)
  return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000)
}

/**
 * 一条网关消息 -> 落库单条消息。
 * accountId 不在此处出现（IngestMessage 不携带），由上层 inboundMessageToBatch 在 IngestBatch 层补。
 * @param source 实时推送用 'live'，历史拉取用 'backfill'。
 */
export function normalizeInbound(
  msg: ProtocolInboundMessage,
  source: MsgSource = 'live'
): IngestMessage {
  const direction: 'in' | 'out' = msg.from === 1 ? 'out' : 'in'
  // 入站（对方发来）状态恒 received；出站（我方发出）按网关给的状态落，缺省 sent。
  const status: MsgStatus =
    direction === 'out' ? (wpStatusToMsgStatus(msg.status) ?? 'sent') : 'received'
  return {
    chatKey: msg.peerJid ?? String(msg.conversationId ?? ''),
    msgKey: String(msg.messageId ?? msg.wpMsgId ?? ''),
    msgId: msg.wpMsgId,
    direction,
    senderKey: msg.senderJid,
    senderName: msg.senderName,
    body: msg.content?.text ?? null,
    mediaType: wpMsgTypeToMediaType(msg.msgType),
    mediaSummary: msg.content?.fileName ?? null,
    msgTimeEpochSec: toEpochSec(msg.waTimestamp ?? msg.createdAt),
    status,
    source,
    sendLocalId: direction === 'out' ? msg.clientMsgId : undefined,
    chatTitle: undefined
  }
}

/** 由已解析出 chatKey 的状态推送 -> 后端 MessageStatusDTO 形状。 */
export function normalizeStatusPush(
  chatKey: string,
  updates: ReadonlyArray<{ msgKey: string; status: MsgStatus }>,
  accountId: number
): IngestStatus {
  const mapped: IngestStatusUpdate[] = updates.map((u) => ({ msgKey: u.msgKey, status: u.status }))
  return { accountId, chatKey, updates: mapped }
}

/** 批量归一化（历史拉取整段会话时复用）。 */
export function normalizeInboundBatch(
  messages: ReadonlyArray<ProtocolInboundMessage>,
  source: MsgSource = 'backfill'
): IngestMessage[] {
  return messages.map((m) => normalizeInbound(m, source))
}
