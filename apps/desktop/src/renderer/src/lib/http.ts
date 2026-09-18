export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8180'

export interface ApiResp<T> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  code: number
  status: number

  constructor(message: string, code: number, status = 200) {
    super(message)
    this.code = code
    this.status = status
  }
}

interface TokenProvider {
  getAccessToken: () => string | null
  refresh: () => Promise<string | null>
}

let tokens: TokenProvider = {
  getAccessToken: () => null,
  refresh: async () => null
}

export function configureHttp(provider: TokenProvider): void {
  tokens = provider
}

let refreshPromise: Promise<string | null> | null = null

async function refreshOnce(refreshToken: string): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const resp = await post<{ accessToken: string }>('/api/auth/refresh', { refreshToken }, false)
        return resp.accessToken
      } catch {
        return null
      } finally {
        setTimeout(() => (refreshPromise = null), 0)
      }
    })()
  }
  return refreshPromise
}

async function request<T>(method: string, path: string, body?: unknown, auth = true, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const access = tokens.getAccessToken()
    if (access) headers.Authorization = `Bearer ${access}`
  }
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new ApiError('无法连接服务器，请确认后端已启动', 50001)
  }

  if (response.status === 401 && auth && !retried && !path.startsWith('/api/auth/')) {
    const renewed = await tokens.refresh()
    if (renewed) {
      return request<T>(method, path, body, auth, true)
    }
    throw new ApiError('未登录或登录已过期', 40100, 401)
  }

  const json = (await response.json().catch(() => null)) as ApiResp<T> | null
  if (!json) {
    throw new ApiError(`响应解析失败 (HTTP ${response.status})`, 50002, response.status)
  }
  if (json.code !== 0) {
    throw new ApiError(json.message, json.code, response.status)
  }
  return json.data
}

function post<T>(path: string, body: unknown, auth: boolean): Promise<T> {
  return request<T>('POST', path, body, auth)
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  refreshOnce
}
