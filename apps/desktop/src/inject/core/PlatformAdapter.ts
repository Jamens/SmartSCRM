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

  /**
   * Where a bubble's translation gets mounted. Defaults to the row itself;
   * platforms whose row spans the full panel width override this to hug the bubble,
   * otherwise the translation drifts to the opposite side of an outgoing message.
   */
  getTranslationAnchor(row: HTMLElement): HTMLElement {
    return row
  }

  /**
   * 这条气泡是不是本端发出的。注入层按归属分流语向：自己发出的走 `send` 语向，
   * 对方发来的走 `receive` 语向（规格 R1）。
   * 基类默认给不出判据（null），未实现检测的平台一律按收到的处理，行为与旧版一致。
   */
  isOutgoingMessage(_row: HTMLElement): boolean | null {
    return null
  }

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

  setupPlatformListeners(_injector: BaseInjector): void {
    /* overridden per platform */
  }

  /** Mount translation behaviour even when a backgrounded view skips foreground lightening. */
  setupTranslationListeners(_injector: BaseInjector): () => void {
    return () => {}
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
