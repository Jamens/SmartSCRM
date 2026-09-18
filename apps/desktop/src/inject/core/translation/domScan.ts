import { MESSAGE_SCAN_INTERVAL } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import { clearMessageStates, getMessageState, saveMessageState } from './messageState'
import { requestTranslate } from './translationQueue'
import {
  ensureTranslationStyle,
  hasTranslationNode,
  removeTranslation,
  removeAllTranslations,
  renderPendingTranslation,
  renderTranslation
} from './renderTranslation'
import { renderManualButton } from './manualButton'

const MAX_RETRY = 3

export function startMessageTranslation(injector: BaseInjector): () => void {
  ensureTranslationStyle()
  const { adapter, state } = injector
  const expandMore = adapter.getSelectors().expandMore
  let stopped = false
  let scanning = false
  let observer: MutationObserver | null = null
  let lastRevision = -1

  const queue = (): void => {
    if (stopped || scanning) return
    scanning = true
    void scan()
      .catch(() => undefined)
      .finally(() => {
        scanning = false
      })
  }

  async function scan(): Promise<void> {
    if (!state.receiveLangSetting.enabled) return
    if (state.translationRevision !== lastRevision) {
      lastRevision = state.translationRevision
      clearMessageStates()
      removeAllTranslations()
      // 去重集合同步放行，否则旧消息再也不进翻译队列（规格 §4.3「语言/渠道变 → 重译」）。
      state.translatedMsgIds.clear()
    }
    for (const row of adapter.getMessageElements()) {
      if (stopped) return
      const msgId = adapter.getMessageId(row)
      if (!msgId) continue
      const text = adapter.getMessageText(row)
      if (!text) continue
      // 折叠长文本里只有截断内容：宁可不译，展开后 MutationObserver 会补译。
      if (expandMore && row.querySelector(expandMore)) continue
      await translateOne(row, msgId, text)
    }
  }

  async function translateOne(row: HTMLElement, msgId: string, text: string): Promise<void> {
    const saved = getMessageState(msgId)
    // 已有译文：只重绘，不再发请求（消息滚出可视区再回来走这条）。
    if (saved && saved.translation !== null && saved.text === text) {
      if (!hasTranslationNode(msgId)) {
        renderTranslation(msgId, row, saved.translation)
        state.markTranslated(msgId)
      }
      return
    }
    // 重试预算花完：停成一个按钮，不是一个循环。
    if (saved && saved.text === text && saved.retryCount >= MAX_RETRY) {
      if (!hasTranslationNode(msgId)) renderManualButton(msgId, row, () => retry(msgId, text))
      state.markTranslated(msgId)
      return
    }
    if (state.isTranslated(msgId)) return

    renderPendingTranslation(msgId, row)
    // R1: sent and received bubbles alike go through the receive direction.
    const result = await requestTranslate(injector, { text, type: 'receive' })
    if (stopped || !row.isConnected) return

    if (result) {
      state.markTranslated(msgId)
      saveMessageState({
        msgId,
        text,
        channel: result.channel,
        toLang: result.toLangCode,
        translation: result.translation,
        retryCount: 0
      })
      renderTranslation(msgId, row, result.translation)
      return
    }

    // 失败：不标记完成，留给下一轮扫描重试；retryCount 累加到 MAX_RETRY 后出手动按钮。
    removeTranslation(msgId)
    saveMessageState({
      msgId,
      text,
      channel: '',
      toLang: '',
      translation: null,
      retryCount: (saved && saved.text === text ? saved.retryCount : 0) + 1
    })
  }

  function retry(msgId: string, text: string): void {
    saveMessageState({ msgId, text, channel: '', toLang: '', translation: null, retryCount: 0 })
    // 手动按钮那条分支已经 markTranslated，这里必须放行一次，否则点击无效。
    state.translatedMsgIds.delete(msgId)
    queue()
  }

  const container = adapter.getMessageContainer()
  if (container) {
    observer = new MutationObserver(queue)
    observer.observe(container, { childList: true, subtree: true })
  }
  const timer = setInterval(queue, MESSAGE_SCAN_INTERVAL)
  state.attachTranslationTimer(timer)

  return () => {
    stopped = true
    clearInterval(timer)
    observer?.disconnect()
    observer = null
    removeAllTranslations()
    clearMessageStates()
  }
}
