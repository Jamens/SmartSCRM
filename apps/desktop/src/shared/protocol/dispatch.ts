// src/shared/protocol/dispatch.ts
// WS 帧分发 + 重连退避的纯逻辑。WebSocket 本身在渲染层 client.ts（浏览器 API），
// 这里只处理「拿到一帧 JSON 后怎么分派」与「第 N 次重连隔多久」——两者都可单测。
//
// 网关协议：WS 帧是 { event, data } 信封（见 ProtocolWsEnvelope）。PING/PONG 是裸 socket
// 字符串，不经过这里；这里只分派 JSON 业务帧，把 envelope.data 透传给对应 handler。

import {
  AUTH_CLOSE_CODES,
  PROTOCOL_WS_TYPES,
  STOP_RECONNECT_CODES,
  type ProtocolWsEnvelope
} from './types.ts'

export interface ProtocolWsHandlers {
  onMessage: (data: unknown) => void
  onStatus: (data: unknown) => void
  onAccountStatus: (data: unknown) => void
  onKickOut: (data: unknown) => void
  onUnknown?: (envelope: ProtocolWsEnvelope) => void
}

/** 按信封 event 分派到对应 handler，并把 envelope.data 透传过去；未知事件交给 onUnknown（缺省静默丢弃）。 */
export function dispatchWsFrame(envelope: ProtocolWsEnvelope, handlers: ProtocolWsHandlers): void {
  switch (envelope?.event) {
    case PROTOCOL_WS_TYPES.MSG_IN:
      handlers.onMessage(envelope.data)
      return
    case PROTOCOL_WS_TYPES.MSG_STATUS:
      handlers.onStatus(envelope.data)
      return
    case PROTOCOL_WS_TYPES.ACCOUNT_STATUS:
      handlers.onAccountStatus(envelope.data)
      return
    case PROTOCOL_WS_TYPES.KICK_OUT:
      handlers.onKickOut(envelope.data)
      return
    default:
      handlers.onUnknown?.(envelope)
  }
}

/**
 * 指数退避（确定性，便于单测；抖动用方在调用处加）。
 * attempt 从 1 起：第 1 次重连等 base、第 2 次 2*base……封顶 maxMs。
 */
export function nextBackoff(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  if (attempt <= 0) return 0
  const exp = baseMs * 2 ** (attempt - 1)
  return Math.min(exp, maxMs)
}

/** 关闭码是否鉴权失败（刷新 token 后重试）。 */
export function isAuthCloseCode(code: number): boolean {
  return AUTH_CLOSE_CODES.has(code)
}

/** 关闭码是否硬停（被踢/被封，不重连）。 */
export function isStopReconnectCode(code: number): boolean {
  return STOP_RECONNECT_CODES.has(code)
}
