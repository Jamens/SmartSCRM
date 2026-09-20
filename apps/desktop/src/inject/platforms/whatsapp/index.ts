import { PlatformAdapter } from '../../core/PlatformAdapter'
import type { BaseInjector } from '../../core/BaseInjector'
import type { SelectorConfig, UserInfo } from '../../core/PlatformAdapter'
import { WHATSAPP } from '../../constants/channels'
import { INPUT, MESSAGE, APP } from './selectors'
import { mountBadge } from '../../shared/ui/badge'
import { replaceEditorText } from '../../core/editorText'
import { sideFromGaps } from '../../core/translation/bubbleDirection'
import { startMessageTranslation } from '../../core/translation/domScan'
import { mountInputPreview } from '../../core/translation/inputPreview'

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
    if (await replaceEditorText(input, text)) return
    // 兜底只写给有内容的情况：innerText = '' 会让页面看起来空了、编辑器却还留着原草稿。
    if (!text) return
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
    return Array.from(document.querySelectorAll<HTMLElement>(MESSAGE.row))
  }

  getMessageId(element: HTMLElement): string | null {
    return element.getAttribute('data-id') ?? null
  }

  getMessageText(element: HTMLElement): string {
    // 只认正文 span，取不到就当没有文本：整行兜底会把时间戳和状态图标的字体连字
    // （"早上8:04wds-ic-read"）当成消息送去翻译。
    return element.querySelector(MESSAGE.textNode)?.textContent?.trim() ?? ''
  }

  getTranslationAnchor(row: HTMLElement): HTMLElement {
    // 行容器铺满整个面板，译文挂在行上会跑到面板左缘，和右侧气泡脱节；
    // 气泡本体（div.copyable-text）才是和消息同宽、同侧的那一层。
    return row.querySelector<HTMLElement>(MESSAGE.bubble) ?? row
  }

  /**
   * 气泡归属（规格 R1 的语向判据）：先看尾巴图标——分组末条才有，但语义确定；
   * 没有尾巴时比气泡在 `[role="row"]` 里的左右留空，贴哪一侧就是哪一侧发的。
   * 两者都给不出方向时返回 null，由扫描侧按收到的兜底，不猜。
   */
  isOutgoingMessage(row: HTMLElement): boolean | null {
    if (row.querySelector(MESSAGE.tailOut)) return true
    if (row.querySelector(MESSAGE.tailIn)) return false
    const host = row.closest<HTMLElement>(MESSAGE.rowHost)
    const bubble = row.querySelector<HTMLElement>(MESSAGE.bubble)
    if (!host || !bubble) return null
    const b = bubble.getBoundingClientRect()
    const h = host.getBoundingClientRect()
    const side = sideFromGaps(b.left - h.left, h.right - b.right)
    return side === null ? null : side === 'out'
  }

  getSelectors(): SelectorConfig {
    return { ...INPUT, ...MESSAGE, ...APP }
  }

  hookInput(_injector: BaseInjector): void {
    /* input interception lands with quick-reply (P4) */
  }

  setupTranslationListeners(injector: BaseInjector): () => void {
    const stopScan = startMessageTranslation(injector)
    const stopPreview = mountInputPreview(injector)
    return () => {
      stopPreview()
      stopScan()
    }
  }

  cleanup(): void {
    this._unmountBadge?.()
    this._unmountBadge = null
  }
}
