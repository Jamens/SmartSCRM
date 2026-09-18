import { getSession } from '../state/session'

const DEFAULT_API_BASE = 'http://localhost:8180'
const REQUEST_TIMEOUT_MS = 5000

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
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
}

/**
 * The only privileged hop in the translation path: an embedded third-party page asks for
 * a translation, this module calls the local backend with the stored token attached.
 * The token never crosses into the preload or the page, and every failure collapses to null
 * so the injected layer can fall back to "no translation".
 */
export async function requestTranslation(
  req: TranslateRequest,
  apiBase?: string
): Promise<TranslateResponse | null> {
  const accessToken = getSession()?.accessToken
  if (!accessToken) return null
  try {
    const res = await fetch(`${apiBase || DEFAULT_API_BASE}/api/translation/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const body = (await res.json()) as { code: number; data?: TranslateResponse }
    return body.code === 0 && body.data ? body.data : null
  } catch {
    return null
  }
}
