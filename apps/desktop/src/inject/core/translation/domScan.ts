import { MESSAGE_SCAN_INTERVAL } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import { isNoopTranslation } from './bubbleDirection'
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
    // 两条语向各自管一侧气泡：都关了才整轮跳过；单边关在 translateOne 里按气泡处理。
    if (!state.receiveLangSetting.enabled && !state.sendLangSetting.enabled) return
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
    // R1：语向按气泡归属分流——本端发出的气泡走 send 语向（把要发出去/已发出的话译成对方语言），
    // 对方发来的走 receive 语向。平台给不出归属判据时（null）按收到的处理。
    const type: 'send' | 'receive' = adapter.isOutgoingMessage(row) === true ? 'send' : 'receive'
    const setting = type === 'send' ? state.sendLangSetting : state.receiveLangSetting
    if (!setting.enabled) {
      if (hasTranslationNode(msgId)) removeTranslation(msgId)
      return
    }
    // 译文挂在平台给出的锚点上：行容器可能铺满整行，锚点才是贴着气泡的那一层。
    const anchor = adapter.getTranslationAnchor(row)
    const saved = getMessageState(msgId)
    // 已有译文：只重绘，不再发请求（消息滚出可视区再回来走这条）。
    // 语向也是命中条件之一——首屏布局未定时归属判据可能先给不出答案，等它给出正确答案的下一轮要重译。
    if (saved && saved.translation !== null && saved.text === text && saved.type === type) {
      if (!hasTranslationNode(msgId) && !isNoopTranslation(text, saved.translation)) {
        renderTranslation(msgId, anchor, saved.translation)
        state.markTranslated(msgId)
      }
      return
    }
    // 重试预算花完：停成一个按钮，不是一个循环（同一语向才作数）。
    if (saved && saved.text === text && saved.type === type && saved.retryCount >= MAX_RETRY) {
      if (!hasTranslationNode(msgId))
        renderManualButton(msgId, anchor, () => retry(msgId, text, type))
      state.markTranslated(msgId)
      return
    }
    // 去重闸门只管「同一语向」的重复请求：语向换了必须放行重译，
    // 否则首屏布局未定时按 receive 译完的那批，等判据稳定下来后就再也翻不过来。
    if (state.isTranslated(msgId) && (!saved || saved.type === type)) return

    renderPendingTranslation(msgId, anchor)
    const result = await requestTranslate(injector, { text, type })
    if (stopped || !row.isConnected) return

    if (result) {
      state.markTranslated(msgId)
      saveMessageState({
        msgId,
        text,
        type,
        channel: result.channel,
        toLang: result.toLangCode,
        translation: result.translation,
        retryCount: 0
      })
      // 同语言气泡（R7 直接返回原文）撤掉「翻译中…」占位，只留原文不留重复行（R10）。
      if (isNoopTranslation(text, result.translation)) removeTranslation(msgId)
      else renderTranslation(msgId, anchor, result.translation)
      return
    }

    // 失败：不标记完成，留给下一轮扫描重试；retryCount 累加到 MAX_RETRY 后出手动按钮。
    removeTranslation(msgId)
    saveMessageState({
      msgId,
      text,
      type,
      channel: '',
      toLang: '',
      translation: null,
      retryCount: (saved && saved.text === text ? saved.retryCount : 0) + 1
    })
  }

  function retry(msgId: string, text: string, type: 'send' | 'receive'): void {
    saveMessageState({
      msgId,
      text,
      type,
      channel: '',
      toLang: '',
      translation: null,
      retryCount: 0
    })
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
