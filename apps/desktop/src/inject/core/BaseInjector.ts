import { StateManager } from './StateManager'
import type { PlatformAdapter } from './PlatformAdapter'
import type { InjectConfig } from '../types'
import { INJECTOR_READY, REPORT_ERROR } from '../constants/events'
import { LOGIN_CHECK_INTERVAL } from '../constants/config'
import { isInjectBackgroundModeEnabled } from './featureFlag'

/**
 * Inject lifecycle owner: adapter init, business IPC wiring, mount + login poll + destroy.
 * Background-UI lightening is already gated by featureFlag; translation mounting comes with P5.
 */
export class BaseInjector {
  readonly adapter: PlatformAdapter
  readonly options: InjectConfig
  readonly state = new StateManager()

  readonly webviewId: string
  readonly userCode: string
  readonly inviteCode: string
  readonly platform: string

  private _loginCheckTimer: ReturnType<typeof setInterval> | null = null
  private _destroyed = false
  private readonly _runtimeOptimizationEnabled: boolean
  private readonly _hostListeners: Array<() => void> = []

  constructor(adapter: PlatformAdapter, options: InjectConfig) {
    this.adapter = adapter
    this.options = options
    this.webviewId = options.webviewId
    this.userCode = options.inviteCode ?? ''
    this.inviteCode = options.inviteCode ?? ''
    this.platform = adapter.getPlatformName()
    this._runtimeOptimizationEnabled = isInjectBackgroundModeEnabled(
      this.platform,
      options.injectBackgroundModeV1
    )
    adapter.webviewId = this.webviewId
  }

  async inject(): Promise<{ isLogin: string }> {
    this._destroyed = false
    try {
      await this.adapter.init()
      this._setupIpcListeners()
      if (!this._runtimeOptimizationEnabled || this.platform !== 'WhatsApp') {
        this._attachForegroundFeatures()
      }
      const isLogin = await this._checkAndSyncLogin()
      return { isLogin: String(isLogin) }
    } catch (error) {
      this._reportError('inject', error)
      throw error
    }
  }

  // ============ Host bridge (window.ele) ============

  sendToHost(event: string, data?: unknown): void {
    window.ele?.sendToHost(event, data)
  }

  send(event: string, data?: unknown): void {
    window.ele?.send(event, data)
  }

  invoke<T = unknown>(channel: string, data?: unknown): Promise<T | undefined> {
    return window.ele ? window.ele.invoke<T>(channel, data) : Promise.resolve(undefined)
  }

  // ============ Internal ============

  private _setupIpcListeners(): void {
    if (!window.ele) return
    const on = <T>(channel: string, handler: (payload: T) => void): void => {
      const off = window.ele!.on(channel, (payload) => handler(payload as T))
      this._hostListeners.push(off)
    }
    on<{ enabled: boolean }>('lang-setting-change', (msg) =>
      this.state.updateLangSetting('receive', { enabled: msg.enabled })
    )
    on<{ enabled: boolean }>('voice-setting-change', (msg) =>
      this.state.updateVoiceSetting({ enabled: msg.enabled })
    )
  }

  private _attachForegroundFeatures(): void {
    try {
      this.adapter.hookInput(this)
      this.adapter.setupPlatformListeners(this)
    } catch (e) {
      this._reportError('foreground', e)
    }
  }

  private async _checkAndSyncLogin(): Promise<boolean> {
    const logged = await this.adapter.checkLogin().catch(() => false)
    if (logged) {
      try {
        const user = await this.adapter.getUserInfo()
        this.state.currentLoginUser = user
      } catch (e) {
        this._reportError('getUserInfo', e)
      }
    }
    this._startLoginPoll()
    this.sendToHost(INJECTOR_READY, { webviewId: this.webviewId, platform: this.platform })
    return logged
  }

  private _startLoginPoll(): void {
    if (this._loginCheckTimer) clearInterval(this._loginCheckTimer)
    this._loginCheckTimer = setInterval(() => {
      if (this._destroyed) return
      void this.adapter
        .checkLogin()
        .then((isLogin) => this.sendToHost('login-status', { webviewId: this.webviewId, isLogin }))
        .catch(() => undefined)
    }, LOGIN_CHECK_INTERVAL)
  }

  private _reportError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[SCRM Inject:${context}]`, error)
    this.send(REPORT_ERROR, { webviewId: this.webviewId, context, message })
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    if (this._loginCheckTimer) clearInterval(this._loginCheckTimer)
    this._hostListeners.forEach((off) => off())
    this._hostListeners.length = 0
    this.adapter.cleanup()
    this.state.destroy()
  }
}
