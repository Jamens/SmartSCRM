import { CSS_CLASSES } from '../../constants/config'
import { removeTranslation, translationNodeId } from './renderTranslation'

/**
 * 停成一个按钮、不是一个循环：后端连着失败时（重试预算花完）或在线线路降级时都从这里落地。
 * `label` 默认「手动翻译」用于预算花完那条；降级那条要点开重试，文案由调用方给（规格 §5）。
 */
export function renderManualButton(
  msgId: string,
  anchor: HTMLElement,
  onRetry: () => void,
  label = '手动翻译'
): void {
  const existing = document.getElementById(translationNodeId(msgId))
  const holder = existing ?? document.createElement('div')
  holder.id = translationNodeId(msgId)
  holder.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
  holder.textContent = ''
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
  if (!existing && anchor.isConnected) anchor.appendChild(holder)
}
