import { EventEmitter } from '../utils/event-emitter'
import type { BaseInjector } from './BaseInjector'

export interface UserInfo {
  id: string
  name: string
  tel?: string
  avatar?: string
}

export interface SelectorConfig {
  [key: string]: string
}

/**
 * Platform adapter contract.
 * Concrete adapters implement DOM access + platform-specific actions.
 */
export abstract class PlatformAdapter extends EventEmitter {
  protected _webviewId = ''

  constructor() {
    super()
    if (new.target === PlatformAdapter) {
      throw new Error('PlatformAdapter 是抽象类，不能直接实例化')
    }
  }

  set webviewId(value: string) {
    this._webviewId = value
  }
  get webviewId(): string {
    return this._webviewId
  }

  logout(): Promise<void> {
    return Promise.resolve()
  }

  abstract getPlatformName(): string
  abstract init(): Promise<void>
  abstract getUserInfo(): Promise<UserInfo>
  abstract sendMessage(chatId: string, text: string): Promise<void>
  abstract getInputElement(): HTMLElement | null
  abstract getInputText(): string
  abstract setInputText(text: string): Promise<void>
  abstract getMessageContainer(): HTMLElement | null
  abstract getMessageElements(): HTMLElement[]
  abstract getMessageId(element: HTMLElement): string | null
  abstract getMessageText(element: HTMLElement): string
  abstract getSelectors(): SelectorConfig
  abstract hookInput(injector: BaseInjector): void

  async getRecentMessages(_chatId: string, _limit = 10): Promise<unknown[]> {
    throw new Error('必须实现 getRecentMessages 方法')
  }

  async checkLogin(): Promise<boolean> {
    return false
  }
  async getContacts(): Promise<unknown[]> {
    return []
  }
  async getUnreadCount(): Promise<number> {
    return 0
  }

  renderTranslation(element: HTMLElement, translatedText: string): void {
    const existing = element.querySelector('.translated')
    if (existing) {
      existing.textContent = translatedText
    } else {
      const el = document.createElement('div')
      el.className = 'translated'
      el.textContent = translatedText
      element.appendChild(el)
    }
  }

  setupPlatformListeners(_injector: BaseInjector): void {
    /* overridden per platform */
  }

  shouldSkipBaseOpenChat(): boolean {
    return false
  }

  shouldSkipBaseGetChatContact(): boolean {
    return false
  }

  cleanup(): void {
    /* overridden per platform */
  }
}
