import { PlatformAdapter } from '../../core/PlatformAdapter'
import type { BaseInjector } from '../../core/BaseInjector'
import type { SelectorConfig, UserInfo } from '../../core/PlatformAdapter'
import { WHATSAPP } from '../../constants/channels'
import { INPUT, MESSAGE, APP } from './selectors'
import { mountBadge } from '../../shared/ui/badge'
import { startMessageTranslation } from '../../core/translation/domScan'

/**
 * WhatsApp platform adapter (skeleton).
 * Implements DOM discovery via selectors; message send/receive APIs land in P6+.
 */
export class WhatsAppAdapter extends PlatformAdapter {
  private _unmountBadge: (() => void) | null = null

  getPlatformName(): string {
    return WHATSAPP
  }

  async init(): Promise<void> {
    this._unmountBadge = mountBadge(this.getPlatformName())
  }

  async checkLogin(): Promise<boolean> {
    return !!document.querySelector(APP.loggedIn)
  }

  async getUserInfo(): Promise<UserInfo> {
    const pane = document.querySelector(APP.loggedIn)
    return {
      id: pane ? 'wa-session' : '',
      name: document.title.replace(/\s*\(.*\)\s*$/, '').trim() || 'WhatsApp'
    }
  }

  getInputElement(): HTMLElement | null {
    return (
      (document.querySelector(INPUT.main) as HTMLElement | null) ??
      (document.querySelector(INPUT.mainAlt) as HTMLElement | null)
    )
  }

  getInputText(): string {
    return this.getInputElement()?.innerText.trim() ?? ''
  }

  async setInputText(text: string): Promise<void> {
    const input = this.getInputElement()
    if (!input) return
    input.focus()
    input.innerText = text
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  }

  async sendMessage(_chatId: string, _text: string): Promise<void> {
    throw new Error('WhatsApp sendMessage 将在消息模块 (P6) 中实现')
  }

  getMessageContainer(): HTMLElement | null {
    return document.querySelector(MESSAGE.container)
  }

  getMessageElements(): HTMLElement[] {
    const container = this.getMessageContainer()
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>(MESSAGE.textNode))
  }

  getMessageId(element: HTMLElement): string | null {
    return element.getAttribute('data-id') ?? null
  }

  getMessageText(element: HTMLElement): string {
    return element.textContent?.trim() ?? ''
  }

  getSelectors(): SelectorConfig {
    return { ...INPUT, ...MESSAGE, ...APP }
  }

  hookInput(_injector: BaseInjector): void {
    /* input interception lands with quick-reply (P4) */
  }

  setupTranslationListeners(injector: BaseInjector): () => void {
    return startMessageTranslation(injector)
  }

  cleanup(): void {
    this._unmountBadge?.()
    this._unmountBadge = null
  }
}
