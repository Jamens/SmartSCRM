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

/**
 * 设备名按 UA 里有没有 Electron 分两种。
 *
 * 写成函数而不是就地三元，是因为登录请求与设置页的设备信息卡都要这一句：
 * 各写一份的话，后端 `device.device_name` 与卡片上那行会指两个不同的字符串。
 */
export function deviceNameOf(userAgent: string): string {
  return userAgent.includes('Electron') ? 'SmartSCRM Desktop' : 'Dev Browser'
}

/** 当前宿主的那一句设备名。 */
export function currentDeviceName(): string {
  return deviceNameOf(navigator.userAgent)
}
