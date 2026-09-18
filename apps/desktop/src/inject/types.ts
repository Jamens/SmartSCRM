/** Ambient typing for the host bridge exposed to embedded views by `preload/view.ts`. */

export interface EleBridge {
  sendToHost: (channel: string, data?: unknown) => void
  send: (channel: string, data?: unknown) => void
  invoke: <T = unknown>(channel: string, data?: unknown) => Promise<T>
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    ele?: EleBridge
    __SCRM_INJECT__?: (platform: string, config: InjectConfig) => Promise<{ isLogin: string }>
    __SCRM_ADAPTER__?: unknown
    __SCRM_INJECTOR__?: unknown
    __SCRM_DESTROY__?: () => void
    __SCRM_GET_ADAPTER__?: () => unknown
    __SCRM_GET_INJECTOR__?: () => unknown
    __SCRM_INJECT_VERSION__?: string
    __SCRM_PLATFORMS__?: Record<string, string>
  }
}

/** Host -> inject translation switches. Language choice is resolved by the backend (R2). */
export interface TranslationFlags {
  receiveEnabled: boolean
  sendEnabled: boolean
  previewEnabled: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
  /** Bumped by the renderer whenever the stored settings actually changed. */
  revision: number
}

export interface InjectConfig {
  webviewId: string
  inviteCode: string
  apiBase?: string
  previewEnabled?: boolean
  injectBackgroundModeV1?: boolean
  [key: string]: unknown
}
