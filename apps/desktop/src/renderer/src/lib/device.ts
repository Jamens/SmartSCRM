export interface UserInfo {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  role: string
  tenantId: number
  inviteCode: string
  tenantName: string
}

let cachedDeviceId: string | null = null

/** Stable per-machine id from the main process; falls back to a browser uuid so the renderer also runs in plain dev browsers. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  if (window.scrm) {
    cachedDeviceId = await window.scrm.app.getDeviceId()
  } else {
    const FALLBACK_KEY = 'scrm-fallback-device-id'
    cachedDeviceId = localStorage.getItem(FALLBACK_KEY) ?? crypto.randomUUID()
    localStorage.setItem(FALLBACK_KEY, cachedDeviceId)
  }
  return cachedDeviceId
}
