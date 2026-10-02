// src/shared/protocol/map.ts
// 网关 WS payload -> 后端 ingest DTO 的纯映射（无副作用、可单测、不依赖任何浏览器 API）。
// 把"从 payload 里抽字段"这一步从 manager 里抽出来，方便 node --test 直接覆盖，
// 也避免在渲染层写一堆 as 转换。所有浏览器接线仍留在 services/protocol/client.ts。
//
// 注意：WS 帧是 { event, data } 信封，client 在 dispatch 时已把 envelope.data 透传过来，
// 所以这里拿到的是 data payload（ProtocolInboundMessage / ProtocolStatusPush），不是整个信封。

import { normalizeInbound, normalizeStatusPush, wpStatusToMsgStatus } from './normalize.ts'
import type {
  ProtocolInboundMessage,
  ProtocolStatusPush,
  IngestBatch,
  IngestStatus
} from './types.ts'

/**
 * 一条入站消息 payload -> 单条消息入库批量。
 * 实时推送用 'live'；落库面 activeChatKey 传 null（协议号无 UI 活动会话上下文，
 * 入站消息一律计未读，与网页 WA 的"当前打开会话不计未读"逻辑解耦）。
 * payload 缺 peerJid 且无 conversationId 时返回 null（静默丢弃，不入站）。
 */
export function inboundMessageToBatch(
  accountId: number,
  msg: ProtocolInboundMessage | null | undefined
): IngestBatch | null {
  if (!msg || (msg.peerJid == null && msg.conversationId == null)) return null
  return {
    accountId,
    activeChatKey: null,
    messages: [normalizeInbound(msg, 'live')]
  }
}

/**
 * 状态推送 payload -> 状态批量更新。
 * 状态推送只带 conversationId + messageId，没有 chatKey；chatKey 由 manager 用
 * conversationId -> peerJid 的映射反查后传入（见 ProtocolSyncManager）。
 * 缺 messageId 或无 chatKey 时返回 null（无法定位，不入站）。
 */
export function statusPushToStatus(
  accountId: number,
  chatKey: string,
  push: ProtocolStatusPush | null | undefined
): IngestStatus | null {
  if (!push || push.messageId == null || !chatKey) return null
  const status = wpStatusToMsgStatus(push.status) ?? 'sent'
  return normalizeStatusPush(chatKey, [{ msgKey: String(push.messageId), status }], accountId)
}
