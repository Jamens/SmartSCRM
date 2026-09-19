import { PlatformAdapter } from '../../core/PlatformAdapter'
import type { BaseInjector } from '../../core/BaseInjector'
import type { SelectorConfig, UserInfo } from '../../core/PlatformAdapter'
import { TELEGRAM } from '../../constants/channels'
import { INPUT, MESSAGE } from './selectors'
import { mountBadge } from '../../shared/ui/badge'
import { replaceEditorText } from '../../core/editorText'

/**
 * Telegram platform adapter (skeleton).
 * Message APIs land with later phases; this mounts UI + discovers DOM nodes.
 */
export class TelegramAdapter extends PlatformAdapter {
  private _unmountBadge: (() => void) | null = null

  getPlatformName(): string {
    return TELEGRAM
  }

  async init(): Promise<void> {
    this._unmountBadge = mountBadge(this.getPlatformName())
  }

  async checkLogin(): Promise<boolean> {
    return !!document.querySelector(MESSAGE.box) || !!document.querySelector(INPUT.box)
  }

  async getUserInfo(): Promise<UserInfo> {
    return { id: 'tg-session', name: 'Telegram' }
  }

  getInputElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(INPUT.editInputId)
  }

  getInputText(): string {
    return this.getInputElement()?.innerText.trim() ?? ''
  }

  async setInputText(text: string): Promise<void> {
    const input = this.getInputElement()
    if (!input) return
    if (replaceEditorText(input, text)) return
    // 兜底：编辑器命令不可用时仍按老办法写一次，至少不静默失败。
    input.focus()
    input.innerText = text
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  }

  async sendMessage(_chatId: string, _text: string): Promise<void> {
    throw new Error('Telegram sendMessage 将在消息模块 (P6) 中实现')
  }

  getMessageContainer(): HTMLElement | null {
    return document.querySelector(MESSAGE.box)
  }

  getMessageElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(MESSAGE.container))
  }

  getMessageId(element: HTMLElement): string | null {
    return element.querySelector(MESSAGE.item)?.getAttribute(MESSAGE.idAttr) ?? null
  }

  getMessageText(element: HTMLElement): string {
    return element.querySelector(MESSAGE.text)?.textContent?.trim() ?? ''
  }

  getSelectors(): SelectorConfig {
    return { ...INPUT, ...MESSAGE }
  }

  hookInput(_injector: BaseInjector): void {
    /* input interception lands with quick-reply (P4) */
  }

  cleanup(): void {
    this._unmountBadge?.()
    this._unmountBadge = null
  }
}
