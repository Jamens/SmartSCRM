import { CSS_CLASSES } from '../../constants/config'
import { removeTranslation, translationNodeId } from './renderTranslation'

/** Shown after the retry budget is spent, so a dead backend stops as a button, not a loop. */
export function renderManualButton(msgId: string, anchor: HTMLElement, onRetry: () => void): void {
  const existing = document.getElementById(translationNodeId(msgId))
  const holder = existing ?? document.createElement('div')
  holder.id = translationNodeId(msgId)
  holder.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
  holder.textContent = ''
  const button = document.createElement('span')
  button.className = CSS_CLASSES.MASK
  button.textContent = '手动翻译'
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
  if (!existing && anchor.isConnected) anchor.appendChild(holder)
}
