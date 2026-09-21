// src/main/services/msgBridge/msgApi.ts
import type { MsgStatus, SendRequest } from '../../../shared/chatTypes.ts'
import type { BatchPayload, BatchResult } from './collectorHub.ts'

export interface AccountRow {
  id: number
  platformType: number
  viewId: string
  name: string
  status: number
}

export interface MsgApiOptions {
  /** 只取 accessToken：token 不进页、不进渲染层（C2）。 */
  token: () => string | null
  apiBase?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface StatusUpdate {
  msgKey: string
  status: MsgStatus
}

/** 后端 `MessageStatusDTO.updates` 上的 `@Size(max = 200)`：超了是 400，所以在这里切批。 */
const STATUS_BATCH_MAX = 200

export const DEFAULT_API_BASE = 'http://localhost:8180'

interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

/**
 * 主进程 ↔ Java 的三跳。全部返回"成功与否"而不是抛错：
 * 采集链不能因为后端重启就断，交给 CollectorHub 的退避与重试。
 */
export function createMsgApi(opts: MsgApiOptions) {
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5_000

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    const token = opts.token()
    // 没登录就没有写入这件事：直接 null，让队列退避，而不是发一个必然 401 的请求。
    if (!token) return null
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) return null
      const env = (await res.json()) as Envelope<T>
      return env.code === 0 && env.data !== undefined ? env.data : null
    } catch {
      return null
    }
  }

  return {
    postBatch(payload: BatchPayload): Promise<BatchResult | null> {
      return call<BatchResult>('/api/messages/batch', {
        accountId: payload.accountId,
        activeChatKey: payload.activeChatKey,
        messages: payload.messages
      })
    },
    /**
     * 后端收的是 `MessageStatusDTO{accountId, chatKey, updates[]}`：平铺 msgKey/status 会被
     * Bean Validation 打成 400，而 `call()` 把非 2xx 一律折成 null——状态推进静默不生效。
     * 一批一请求，切批只在这一处：调用方各自切就会切出不一样的边界。
     * 中途某批失败就停在这里返回 null——前面的批已经提交了，状态阶梯单调，重复推进无害，
     * 所以不为"半成功"另造一个部分结果类型。
     */
    async postStatuses(input: { accountId: number; chatKey: string; updates: StatusUpdate[] }): Promise<{ updated: number } | null> {
      let updated = 0
      for (let i = 0; i < input.updates.length; i += STATUS_BATCH_MAX) {
        const part = await call<{ updated?: number }>('/api/messages/status', {
          accountId: input.accountId,
          chatKey: input.chatKey,
          updates: input.updates.slice(i, i + STATUS_BATCH_MAX)
        })
        if (!part) return null
        // `call()` 只保证信封里有 data，不保证里面有 updated：直接累加会把整批计数变成 NaN。
        updated += part.updated ?? 0
      }
      return { updated }
    },
    /** GET 用 fetch 单独走一遍：账号列表只有挂载与 5 分钟刷新时读，不需要批量语义。 */
    async listAccounts(): Promise<AccountRow[]> {
      const token = opts.token()
      if (!token) return []
      try {
        const res = await doFetch(`${base}/api/platform-accounts`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs)
        })
        if (!res.ok) return []
        const env = (await res.json()) as Envelope<AccountRow[]>
        return env.code === 0 && Array.isArray(env.data) ? env.data : []
      } catch {
        return []
      }
    }
  }
}

/** 发送前的一行校验：桥和渲染层都拦一次，空文本永远不该出主进程。 */
export function isSendable(req: SendRequest): boolean {
  return typeof req.text === 'string' && req.text.trim().length > 0 && req.text.length <= 5_000
}
