// src/shared/protocol/map.ts
// 网关 WS payload -> 后端 ingest DTO 的纯映射（无副作用、可单测、不依赖任何浏览器 API）。
// 把"从 payload 里抽字段"这一步从 manager 里抽出来，方便 node --test 直接覆盖，
// 也避免在渲染层写一堆 as 转换。所有浏览器接线仍留在 services/protocol/client.ts。
//
// 注意：WS 帧是 { event, data } 信封，client 在 dispatch 时已把 envelope.data 透传过来，
// 所以这里拿到的是 data payload（ProtocolInboundMessage / ProtocolStatusPush），不是整个信封。

import { normalizeInbound, normalizeStatusPush, wpStatusToMsgStatus } from './normalize.ts'
import type { SendReceipt } from '../chatTypes.ts'
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

// ---------------------------------------------------------------------------
// 出站发送（B27 出站腿）：渲染层把 type-7 账号的发送直连协议网关 REST，不经 WebContentsView 桥。
// 纯逻辑抽在这里，sendFn 注入以便 node --test 覆盖；manager 只负责接线与生命周期。
// ---------------------------------------------------------------------------

/** 网关 sendMessage 的响应形态（字段按真实契约容忍解析，缺省回退 clientMsgId）。 */
export interface ProtocolSendResponse {
  messageId?: number | string
  wpMsgId?: string
  msgKey?: string
  status?: number | string
}

/**
 * 出站消息去重键：与入站 normalizeInbound 同优先级 `messageId ?? wpMsgId ?? msgKey`。
 * 网关稍后回推的 WA_MSG_IN_PUSH(from:1) 会以同一 msgKey 命中、合并同一条，不会长出第二行。
 * 三者皆无时退回 clientMsgId（我们自己生成的幂等键）——理论兜底，真实网关必回其一。
 */
export function protocolSendMsgKey(
  resp: ProtocolSendResponse | null | undefined,
  fallbackClientMsgId: string
): string {
  const id = resp?.messageId ?? resp?.wpMsgId ?? resp?.msgKey
  return id != null && id !== '' ? String(id) : fallbackClientMsgId
}

/**
 * 出站发送编排（纯函数，sendFn 注入以便单测）：调用网关 -> 取回 msgKey -> 包成 SendReceipt。
 * 与网页 WA 桥的乐观气泡路径对齐：useSendText 先 appendPending（键=~localId），
 * 拿到 msgKey 后 settleLocalId 换键，网关回声 WA_MSG_IN_PUSH 补全 body/status。
 * 因此这里**不**单独 ingest，只负责把 msgKey 交回上层（回执形状与网页桥同构，可复用 outcomeOf）。
 */
export async function runProtocolSend(
  params: { accountId: number; chatKey: string; text: string; clientMsgId: string },
  sendFn: (accountId: number, toJid: string, text: string, clientMsgId: string) => Promise<unknown>
): Promise<SendReceipt> {
  let raw: unknown
  try {
    raw = await sendFn(params.accountId, params.chatKey, params.text, params.clientMsgId)
  } catch (e) {
    return {
      localId: '',
      ok: false,
      error: 'SEND_FAILED',
      detail: e instanceof Error ? e.message : String(e)
    }
  }
  const resp = raw as ProtocolSendResponse | null | undefined
  if (!resp) {
    return { localId: '', ok: false, error: 'SEND_FAILED', detail: '网关未返回发送结果' }
  }
  return { localId: '', ok: true, msgKey: protocolSendMsgKey(resp, params.clientMsgId) }
}
