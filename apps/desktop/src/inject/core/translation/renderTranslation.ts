import { CSS_CLASSES } from '../../constants/config'

const STYLE_ID = 'scrm-inject-style'
const TEXT_CLASS = 'translated-text'

export function translationNodeId(msgId: string): string {
  return `translation-${msgId}`
}

/** Ids are assigned through the DOM API, so `getElementById` is the only safe lookup. */
export function hasTranslationNode(msgId: string): boolean {
  return document.getElementById(translationNodeId(msgId)) !== null
}

export function ensureTranslationStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `.${CSS_CLASSES.TRANSLATED}{margin-top:4px;font-size:13px;line-height:18px;opacity:.85;white-space:pre-wrap;word-break:break-word}`,
    `.${CSS_CLASSES.TRANSLATED} .${TEXT_CLASS}{display:block}`,
    `.${CSS_CLASSES.TRANSLATING}{opacity:.5}`,
    `.${CSS_CLASSES.TRANSLATE_ERROR}{opacity:.8}`,
    `.${CSS_CLASSES.MASK}{display:inline-block;margin-top:2px;font-size:12px;color:#00a884;cursor:pointer;border-bottom:1px dashed currentColor}`
  ].join('\n')
  document.head.appendChild(style)
}

/** The host element is the platform's translation anchor, not necessarily the message row. */
function node(msgId: string, anchor: HTMLElement): HTMLElement | null {
  const existing = document.getElementById(translationNodeId(msgId))
  if (existing) return existing
  if (!anchor.isConnected) return null
  const created = document.createElement('div')
  created.id = translationNodeId(msgId)
  created.className = CSS_CLASSES.TRANSLATED
  anchor.appendChild(created)
  return created
}

export function renderPendingTranslation(msgId: string, anchor: HTMLElement): void {
  const holder = node(msgId, anchor)
  if (!holder) return
  holder.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATING}`
  holder.textContent = '翻译中…'
}

export function renderTranslation(
  msgId: string,
  anchor: HTMLElement,
  text: string,
  opts: { error?: boolean } = {}
): void {
  const holder = node(msgId, anchor)
  if (!holder) return
  holder.className = opts.error
    ? `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
    : CSS_CLASSES.TRANSLATED
  holder.textContent = ''
  const span = document.createElement('span')
  span.className = TEXT_CLASS
  span.textContent = text
  holder.appendChild(span)
}

export function removeTranslation(msgId: string): void {
  document.getElementById(translationNodeId(msgId))?.remove()
}

export function removeAllTranslations(): void {
  document.querySelectorAll(`.${CSS_CLASSES.TRANSLATED}`).forEach((el) => el.remove())
}
