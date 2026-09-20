import { getSession, saveSession } from '../state/session'

const DEFAULT_API_BASE = 'http://localhost:8180'
const REQUEST_TIMEOUT_MS = 5000

interface RefreshData {
  accessToken: string
  refreshToken?: string
}

let refreshing: Promise<string | null> | null = null

const resolveBase = (apiBase?: string): string => (apiBase || DEFAULT_API_BASE).replace(/\/$/, '')

/**
 * Exchange the stored refresh token for a fresh access token and write the pair back to the
 * session file, so every main-process reader of `getSession()` picks it up on its next call.
 * Concurrency note: parallel 401s share one in-flight refresh instead of stampeding the endpoint.
 */
function refreshAccessToken(base: string): Promise<string | null> {
  if (refreshing) return refreshing
  refreshing = (async (): Promise<string | null> => {
    const stored = getSession()
    if (!stored?.refreshToken) return null
    try {
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const body = (await res.json().catch(() => null)) as {
        code: number
        data?: RefreshData
      } | null
      const data = body?.code === 0 ? body.data : undefined
      if (!data?.accessToken) return null
      const latest = getSession() ?? stored
      saveSession({
        ...latest,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? latest.refreshToken
      })
      return data.accessToken
    } catch {
      return null
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

function sendAuthed(
  base: string,
  path: string,
  init: RequestInit,
  accessToken?: string
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
}

/**
 * The single privileged hop for main-process calls to the local backend: attach the stored
 * access token, and — because a long-lived window outlives the token's TTL — turn a 401 into
 * one refresh + one retry before giving up. Only the token ever touches this module; it never
 * crosses into the preload or an injected third-party page.
 *
 * The renderer keeps its own copy of the pair in memory and refreshes there independently
 * (`renderer/src/lib/http.ts`). Refresh tokens are stateless and stay valid until their own
 * expiry, so the two paths can each renew without invalidating the other; the loser of the
 * race simply writes its pair back a second time.
 */
export async function authedFetch(
  path: string,
  init: RequestInit,
  apiBase?: string
): Promise<Response> {
  const base = resolveBase(apiBase)
  // 本地没有会话文件时不发无凭据请求：直接给一个 401，调用方按既有语义塌成 null / 空结果。
  if (!getSession()) return new Response(null, { status: 401, statusText: 'no-session' })
  const response = await sendAuthed(base, path, init, getSession()?.accessToken)
  if (response.status !== 401) return response
  const renewed = await refreshAccessToken(base)
  if (!renewed) return response
  return sendAuthed(base, path, init, renewed)
}
