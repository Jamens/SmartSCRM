// src/renderer/src/services/protocol/client.ts
// 协议号（B27）网关客户端：渲染进程原生 WebSocket + fetch 直连外部 protocol 服务。
// 零 WebView / 零注入 / 零本地表：协议号不走注入层，也不进本地库。
// 纯逻辑（帧分发、退避）在 @shared/protocol，这里只负责浏览器 API 接线。
//
// 网关契约（见 @shared/protocol/types.ts 与 README §7）：
// - WS 帧是 { event, data } 信封；PING/PONG 是裸 socket 字符串（非 JSON）。
// - accesstoken 走 query（Bearer 前缀会被剥离）；鉴权关闭码 4001–4004 刷新 token 后重试，
//   4005/4007 硬停（被踢/被封）不重连。

import {
  dispatchWsFrame,
  isAuthCloseCode,
  isStopReconnectCode,
  nextBackoff
} from '@shared/protocol/dispatch.ts'
import {
  WS_ECHO_REPLY_FRAME,
  WS_PING_FRAME,
  WS_PING_INTERVAL_MS,
  WS_PONG_FRAME,
  type ProtocolWsEnvelope
} from '@shared/protocol/types.ts'

export interface ProtocolClientOptions {
  baseUrl: string
  wsUrl: string
  getToken: () => string | null
  /** WA_MSG_IN_PUSH.data。 */
  onInbound: (data: unknown) => void
  /** WA_MSG_STATUS_PUSH.data。 */
  onStatus: (data: unknown) => void
  /** WA_ACCOUNT_STATUS_PUSH.data（在线/异常/登出/封禁）。 */
  onAccountStatus?: (data: unknown) => void
  /** 鉴权失败（4001–4004）时回调，期望返回刷新后的 token；返回 null 表示无法续连。 */
  onAuthFailure?: () => Promise<string | null>
}

class RestError extends Error {
  status?: number
}

export class ProtocolClient {
  private ws: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private reconnectAttempt = 0

  constructor(private readonly opts: ProtocolClientOptions) {}

  // ---------------- REST（网关会话 / 消息 / 发送接口） ----------------
  private async rest<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.opts.getToken()
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {})
      }
    })
    if (!res.ok) {
      const e = new RestError(`protocol REST ${path} -> ${res.status}`) as RestError
      e.status = res.status
      throw e
    }
    return (await res.json().catch(() => ({}) as T)) as T
  }

  listConversations(params?: Record<string, unknown>): Promise<unknown> {
    const qs = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
    return this.rest<unknown>(`/conversations${qs}`)
  }

  fetchMessages(
    conversationId: string | number,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const qs = params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''
    return this.rest<unknown>(
      `/conversations/${encodeURIComponent(String(conversationId))}/messages${qs}`
    )
  }

  markRead(conversationId: string | number, lastReadMessageId?: number): Promise<void> {
    return this.rest<void>(`/conversations/${encodeURIComponent(String(conversationId))}/read`, {
      method: 'POST',
      body: JSON.stringify({ lastReadMessageId })
    })
  }

  sendMessage(
    accountId: number,
    toJid: string,
    text: string,
    clientMsgId?: string
  ): Promise<unknown> {
    const body = {
      accountId,
      clientMsgId: clientMsgId ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: { text },
      msgType: 1,
      toJid
    }
    return this.rest<unknown>('/messages/send', { method: 'POST', body: JSON.stringify(body) })
  }

  mediaStsCredential(
    sha256: string,
    fileName: string,
    fileSize: number,
    contentType?: string
  ): Promise<unknown> {
    return this.rest<unknown>('/media/sts-credential', {
      method: 'POST',
      body: JSON.stringify({ sha256, fileName, fileSize, contentType })
    })
  }

  /** 账号导入（服务端 POST /accounts/import/batch）。7 字段模板：手机号 + 6 段 auth/base64。 */
  importAccounts(rows: ReadonlyArray<Record<string, unknown>>): Promise<unknown> {
    return this.rest<unknown>('/accounts/import/batch', {
      method: 'POST',
      body: JSON.stringify(rows)
    })
  }

  /** 账号连接（服务端 POST /accounts/connect，从公共代理池领节点，单批上限 200）。 */
  connectAccounts(accountIds: number[], proxyRegion?: string): Promise<unknown> {
    return this.rest<unknown>('/accounts/connect', {
      method: 'POST',
      body: JSON.stringify({ accountIds, proxyRegion })
    })
  }

  // ---------------- WS ----------------
  connect(): void {
    if (this.stopped) return
    if (!this.opts.wsUrl) {
      console.warn('[protocol] PROTOCOL_WS_URL 未配置，协议号通道静默（不连接外部网关）')
      return
    }
    const token = this.stripBearer(this.opts.getToken())
    if (!token) return // 无 token：manager 在拿到 token 后重连
    const ws = new WebSocket(this.buildSocketUrl(token))
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(WS_PING_FRAME)
      }, WS_PING_INTERVAL_MS)
    }

    ws.onmessage = (ev) => {
      const raw = String(ev.data ?? '')
      // 心跳是裸 socket 字符串，不是 JSON 信封
      if (raw === WS_PONG_FRAME || raw === WS_ECHO_REPLY_FRAME) return
      if (raw === WS_PING_FRAME) {
        if (ws.readyState === WebSocket.OPEN) ws.send(WS_PONG_FRAME)
        return
      }
      let env: ProtocolWsEnvelope
      try {
        env = JSON.parse(raw) as ProtocolWsEnvelope
      } catch {
        return
      }
      dispatchWsFrame(env, {
        onMessage: (data) => this.opts.onInbound(data),
        onStatus: (data) => this.opts.onStatus(data),
        onAccountStatus: (data) => this.opts.onAccountStatus?.(data),
        onKickOut: () => this.disconnect(),
        onUnknown: () => {}
      })
    }

    ws.onclose = async (ev) => {
      this.clearPing()
      this.ws = null
      if (this.stopped) return
      if (isStopReconnectCode(ev.code)) {
        this.stopped = true // 被踢/被封，硬停
        return
      }
      if (isAuthCloseCode(ev.code)) {
        const next = this.opts.onAuthFailure ? await this.opts.onAuthFailure() : null
        if (!next) {
          this.stopped = true
          return
        }
        this.scheduleReconnect(0) // 拿到新 token，立即重连
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // 错误后浏览器会触发 close，统一在 onclose 处理重连
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  private stripBearer(token?: string | null): string {
    if (!token) return ''
    return token.replace(/^Bearer\s+/i, '').trim()
  }

  private buildSocketUrl(token: string): string {
    const url = new URL(this.opts.wsUrl)
    if (!url.searchParams.has('accesstoken') && !url.searchParams.has('token')) {
      url.searchParams.set('accesstoken', token)
    }
    return url.toString()
  }

  private scheduleReconnect(delay?: number): void {
    if (this.stopped) return
    this.reconnectAttempt += 1
    const wait = delay ?? nextBackoff(this.reconnectAttempt)
    this.reconnectTimer = setTimeout(() => this.connect(), wait)
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /** 鉴权失败（4001–4004）/ 被踢（4005/4007）/ 主动 disconnect 后为 true；manager 据此决定要不要重建。 */
  isStopped(): boolean {
    return this.stopped
  }

  disconnect(): void {
    this.stopped = true
    this.clearPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }
}
