import { MESSAGE_SCAN_INTERVAL } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import type { DegradeFields } from '../../../shared/degradeCopy'
import { degradeCopy } from '../../../shared/degradeCopy'
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
import { renderManualButton, renderManualNote } from './manualButton'

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
    // 降级稳态：上次拿到的是本地模拟引擎的原样回显（在线线路掉了/未配密钥）。
    // 它不是译文，所以 `saved.translation` 是 null、上面那条重绘分支不会命中；这里也不发请求，
    // 只把降级那一格重新挂回锚点——滚出可视区再滚回来话还在，不再整行悄悄消失。
    // 挂的是重试入口还是一句说明，看存下来的那两个降级字段（与刚拿到结果那一趟同一个判据）。
    if (saved && saved.degraded === true && saved.text === text && saved.type === type) {
      if (!hasTranslationNode(msgId))
        renderDegraded(msgId, anchor, text, type, {
          degradeReason: saved.degradeReason,
          degradeRetryable: saved.degradeRetryable
        })
      state.markTranslated(msgId)
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
    // 会话提示进请求：同一句话在两个会话里可能走两个语向（生效面 ②），共用了 inflight
    // 就会把上一个会话的语种画到这一会话的气泡上。它只用于页内去重，不出页。
    // msgId 是页内 data-id（裸平台消息 id）：后端按它 + 主进程盖的会话作用域取这条消息已存过的译文。
    const result = await requestTranslate(injector, {
      text,
      type,
      chatHint: adapter.chatHint(),
      msgId
    })
    if (stopped || !row.isConnected) return

    if (result) {
      if (result.degraded) {
        // 降级那份「译文」是模拟引擎的原样回显：存成 translation 就等于把回显登记成真译文，
        // 下一轮扫描/重绘会把它当译文画出来——那正是本次要治的静默降级，只是换了个地方复发。
        // 所以 translation 记 null、只记降级那一格的三个字段（形状 + 原因 + 重试得了吗）；
        // markTranslated 挡住扫描循环反复追问厂商。
        saveMessageState({
          msgId,
          text,
          type,
          channel: result.channel,
          toLang: result.toLangCode,
          translation: null,
          retryCount: 0,
          degraded: true,
          degradeReason: result.degradeReason,
          degradeRetryable: result.degradeRetryable
        })
        state.markTranslated(msgId)
        renderDegraded(msgId, anchor, text, type, result)
        return
      }
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
      // 非降级才会走到这里：同语言气泡（R7 直接返回原文）撤掉「翻译中…」占位，只留原文不留重复行（R10）。
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

  /**
   * 降级那一格有两种形状（`degradeCopy` 按后端的 `degradeRetryable` 判）：
   * - 瞬时故障（厂商 HTTP / 断网 / 请求被中断）→ 一颗能点开强制重译的按钮；
   * - 配置性死路（未配密钥 / 语种不在这条线路的表上）→ 一句写明原因、**点不动**的说明。
   * 死路不给按钮的理由：重试走的还是同一条线路、同一份缺着的凭据，那颗点不亮的按钮等于对用户
   * 说"再试一次就有救"。恢复路径不经过这里——改档位或配密钥时 `translationRevision` 自增，
   * 整轮重扫会重新发一次请求。
   */
  function renderDegraded(
    msgId: string,
    anchor: HTMLElement,
    text: string,
    type: 'send' | 'receive',
    fields: DegradeFields
  ): void {
    const { shape, label } = degradeCopy({ degraded: true, ...fields })
    if (shape === 'dead') {
      renderManualNote(msgId, anchor, label)
      return
    }
    renderDegradedRetry(msgId, anchor, text, type)
  }

  /**
   * 可重试那条按钮：点开是一次 `noCache: true` 的强制重译。
   * 要 `noCache` 不是为了绕开"这次失败存下来的东西"——降级既不写内容缓存也不回写消息级译文，
   * 它什么都没存。真正会拦这次重试的是**另一条消息**留下的内容缓存：同一句文本只要在别处
   * 成功译过一次，走缓存就会在回写之前提前返回，这条消息的 `translated_body` 永远补不上。
   * `noCache` 保证这一次真的问到厂商，"点通了才入库"（规格 §5）才有落点。
   */
  function renderDegradedRetry(
    msgId: string,
    anchor: HTMLElement,
    text: string,
    type: 'send' | 'receive'
  ): void {
    const onRetry = (): void => {
      void requestTranslate(injector, {
        text,
        type,
        chatHint: adapter.chatHint(),
        msgId,
        noCache: true
      })
        .then((r) => {
          if (stopped) return
          if (!r) {
            // 这次连响应都没有：按钮刚被点掉，原样挂回去，不留一片空白。
            renderDegradedRetry(msgId, anchor, text, type)
            return
          }
          if (r.degraded) {
            // 又降级了：形状按**这一次**的原因重判（重试途中可能从瞬时故障变成死路），
            // 消息态也跟着换，否则滚出可视区再滚回来画的还是上一趟那一格。
            saveMessageState({
              msgId,
              text,
              type,
              channel: r.channel,
              toLang: r.toLangCode,
              translation: null,
              retryCount: 0,
              degraded: true,
              degradeReason: r.degradeReason,
              degradeRetryable: r.degradeRetryable
            })
            renderDegraded(msgId, anchor, text, type, r)
            return
          }
          if (isNoopTranslation(text, r.translation)) removeTranslation(msgId)
          else renderTranslation(msgId, anchor, r.translation)
          saveMessageState({
            msgId,
            text,
            type,
            channel: r.channel,
            toLang: r.toLangCode,
            translation: r.translation,
            retryCount: 0
          })
          state.markTranslated(msgId)
        })
        .catch(() => {
          if (!stopped) renderDegradedRetry(msgId, anchor, text, type)
        })
    }
    renderManualButton(msgId, anchor, onRetry, '翻译失败 · 点此重试', 'retry')
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
