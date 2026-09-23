import { authedFetch } from './authedFetch'

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
}

/**
 * 会话归属：生效面 ② 的那两个字段。类型上就把它与 `TranslateRequest` 分开，是因为
 * 这条边界只有主进程能过——页内那份 `chatHint` 只是去重提示，永远不填进这里。
 */
export interface TranslateContext {
  accountId?: number
  chatKey?: string
}

export interface TranslateResponse {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
  /** 线上线路失败或未配置密钥时为 true：译文来自本地模拟引擎，且该结果不入缓存 */
  degraded: boolean
  degradeReason: string | null
}

/**
 * The only privileged hop in the translation path: an embedded third-party page asks for
 * a translation, this module calls the local backend with the stored token attached.
 * The token never crosses into the preload or the page, and every failure collapses to null
 * so the injected layer can fall back to "no translation".
 *
 * `authedFetch` owns the auth lifetime: an embedded window stays open far longer than the
 * access token's TTL, so a 401 here means "stale token", not "logged out".
 *
 * `ctx` 是调用方（只有主进程那一个调用点）按 `viewId` 反查出来的会话归属，不是页面给的字段：
 * 两个都不带时后端按全局语向解析，那就是 ② 的默认态。
 */
export async function requestTranslation(
  req: TranslateRequest,
  ctx: TranslateContext = {},
  apiBase?: string
): Promise<TranslateResponse | null> {
  try {
    const res = await authedFetch(
      '/api/translation/translate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...req, ...ctx })
      },
      apiBase
    )
    if (!res.ok) return null
    const body = (await res.json()) as { code: number; data?: TranslateResponse }
    return body.code === 0 && body.data ? body.data : null
  } catch {
    return null
  }
}
