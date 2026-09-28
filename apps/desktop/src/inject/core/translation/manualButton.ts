import { CSS_CLASSES } from '../../constants/config'
import { removeTranslation, translationNodeId } from './renderTranslation'

/** 两种降级形状的证人属性：`retry` 点得动，`dead` 只是一句话（`degradeCopy` 判的分岔）。 */
const DEGRADE_ATTR = 'data-p7-degrade'

function errorHolder(msgId: string, anchor: HTMLElement): HTMLElement | null {
  const existing = document.getElementById(translationNodeId(msgId))
  if (existing) return existing
  if (!anchor.isConnected) return null
  const created = document.createElement('div')
  created.id = translationNodeId(msgId)
  created.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
  anchor.appendChild(created)
  return created
}

/**
 * 停成一个按钮、不是一个循环：后端连着失败时（重试预算花完）或在线线路可重试降级时都从这里落地。
 * `label` 默认「手动翻译」用于预算花完那条；降级那条要点开重试，文案由调用方给（规格 §5）。
 */
export function renderManualButton(
  msgId: string,
  anchor: HTMLElement,
  onRetry: () => void,
  label = '手动翻译',
  degrade?: 'retry'
): void {
  const holder = errorHolder(msgId, anchor)
  if (!holder) return
  holder.textContent = ''
  if (degrade) holder.setAttribute(DEGRADE_ATTR, degrade)
  else holder.removeAttribute(DEGRADE_ATTR)
  const button = document.createElement('span')
  button.className = CSS_CLASSES.MASK
  button.textContent = label
  button.setAttribute('role', 'button')
  button.tabIndex = 0
  const run = (): void => {
    removeTranslation(msgId)
    onRetry()
  }
  button.addEventListener('click', run)
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') run()
  })
  holder.appendChild(button)
}

/**
 * 配置性死路那一格：同一枚锚点、同一个节点 id，但**没有按钮形状**——没有 `role="button"`、
 * 没有点击监听，也没有 `tabIndex`。它是一句读给人看的话：重试不会好，要改的是那条线路。
 */
export function renderManualNote(msgId: string, anchor: HTMLElement, label: string): void {
  const holder = errorHolder(msgId, anchor)
  if (!holder) return
  holder.textContent = ''
  holder.setAttribute(DEGRADE_ATTR, 'dead')
  const note = document.createElement('span')
  note.className = CSS_CLASSES.DEGRADE_NOTE
  note.textContent = label
  holder.appendChild(note)
}
