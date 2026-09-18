import { DEFAULT_RECEIVE_LANG_SETTING, DEFAULT_SEND_LANG_SETTING } from '../constants/config'
import type { TranslationFlags } from '../types'

export interface LangSetting {
  enabled: boolean
  fromLangCode: string
  toLangCode: string
}

export interface LoginUser {
  id: string
  name: string
  tel?: string
  avatar?: string
}

type Watcher = (value: any, oldValue: any) => void

/** Central state container for an injected page. */
export class StateManager {
  isSending = false
  receiveLangSetting: LangSetting = { ...DEFAULT_RECEIVE_LANG_SETTING }
  sendLangSetting: LangSetting = { ...DEFAULT_SEND_LANG_SETTING }
  previewEnabled = true
  disableChinese = true
  disableChinesePreventSend = false
  currentChatId: string | null = null
  currentChatUser = ''
  currentLoginUser: LoginUser | null = null
  isScrollToBottom = true
  initDone = new Set<string>()
  translatedMsgIds = new Set<string>()
  detectionMsgId = -1
  idNameMap: Record<string, string> = {}
  chatInfo: Record<string, unknown> = {}
  unreadCount = 0

  private _translationTimer: ReturnType<typeof setInterval> | null = null
  private _listeners = new Map<string, Set<Watcher>>()

  get(key: string): unknown {
    return (this as Record<string, unknown>)[key]
  }

  set(key: string, value: unknown): void {
    const holder = this as Record<string, unknown>
    const oldValue = holder[key]
    holder[key] = value
    this._listeners.get(key)?.forEach((cb) => cb(value, oldValue))
  }

  update(updates: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(updates)) this.set(key, value)
  }

  watch(key: string, callback: Watcher): () => void {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set())
    this._listeners.get(key)!.add(callback)
    return () => this._listeners.get(key)?.delete(callback)
  }

  updateTranslationFlags(flags: Partial<TranslationFlags>): void {
    if (typeof flags.receiveEnabled === 'boolean') {
      this.receiveLangSetting = { ...this.receiveLangSetting, enabled: flags.receiveEnabled }
    }
    if (typeof flags.sendEnabled === 'boolean') {
      this.sendLangSetting = { ...this.sendLangSetting, enabled: flags.sendEnabled }
    }
    if (typeof flags.previewEnabled === 'boolean') this.previewEnabled = flags.previewEnabled
    if (typeof flags.disableChinese === 'boolean') this.disableChinese = flags.disableChinese
    if (typeof flags.disableChinesePreventSend === 'boolean') {
      this.disableChinesePreventSend = flags.disableChinesePreventSend
    }
  }

  attachTranslationTimer(timer: ReturnType<typeof setInterval>): void {
    if (this._translationTimer) clearInterval(this._translationTimer)
    this._translationTimer = timer
  }

  markInitDone(feature: string): void {
    this.initDone.add(feature)
  }

  isInitDone(feature: string): boolean {
    return this.initDone.has(feature)
  }

  clearInitDone(): void {
    this.initDone.clear()
  }

  markTranslated(msgId: string): void {
    this.translatedMsgIds.add(msgId)
  }

  isTranslated(msgId: string): boolean {
    return this.translatedMsgIds.has(msgId)
  }

  reset(): void {
    this.isSending = false
    this.currentChatId = null
    this.currentChatUser = ''
    this.currentLoginUser = null
    this.isScrollToBottom = true
    this.initDone.clear()
    this.translatedMsgIds.clear()
    this.detectionMsgId = -1
    this.idNameMap = {}
    this.chatInfo = {}
    this.unreadCount = 0
    if (this._translationTimer) {
      clearInterval(this._translationTimer)
      this._translationTimer = null
    }
  }

  destroy(): void {
    this.reset()
    this._listeners.clear()
  }
}
