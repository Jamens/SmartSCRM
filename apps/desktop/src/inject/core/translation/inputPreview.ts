import { CSS_CLASSES, TRANSLATE_THROTTLE_TIME } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import { requestTranslate, type TranslateResponse } from './translationQueue'

const PREVIEW_ID = 'scrm-inject-preview'
/** Marks the Enter this module re-dispatches, so it reaches the platform instead of being intercepted again. */
const FORWARDED_ENTER = '__scrmForwardedEnter'

/**
 * Send-direction preview (R1: the only place the `send` language direction is used).
 * The request goes out with `input: true`, so the backend never writes half-typed text
 * into the translation cache.
 */
export function mountInputPreview(injector: BaseInjector): () => void {
  const { adapter, state } = injector
  let layer: HTMLElement | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let lastText = ''
  let stopped = false

  function ensureLayer(): HTMLElement {
    const found = document.getElementById(PREVIEW_ID)
    if (found) return found
    const created = document.createElement('div')
    created.id = PREVIEW_ID
    created.className = CSS_CLASSES.TRANSLATED
    created.style.position = 'fixed'
    created.style.zIndex = '2147483000'
    created.style.maxWidth = '360px'
    created.style.background = 'rgba(11, 23, 51, 0.92)'
    created.style.color = '#fff'
    created.style.padding = '6px 10px'
    created.style.borderRadius = '10px'
    document.body.appendChild(created)
    return created
  }

  function place(input: HTMLElement): void {
    if (!layer) return
    const rect = input.getBoundingClientRect()
    layer.style.left = `${Math.max(8, rect.left)}px`
    layer.style.top = `${Math.max(8, rect.top - 12)}px`
    layer.style.transform = 'translateY(-100%)'
  }

  function hide(): void {
    if (layer) layer.style.display = 'none'
    lastText = ''
  }

  function paint(result: TranslateResponse): void {
    if (!layer || stopped) return
    layer.style.display = 'block'
    layer.textContent = ''

    const text = document.createElement('span')
    text.className = 'translated-text'
    text.textContent = result.translation
    layer.appendChild(text)

    if (state.disableChinese && result.containsChinese) {
      const hint = document.createElement('div')
      hint.className = CSS_CLASSES.TRANSLATE_ERROR
      hint.textContent = '译文含中文，可能被拦截'
      layer.appendChild(hint)
    }

    const use = document.createElement('span')
    use.className = CSS_CLASSES.MASK
    use.textContent = '用译文替换输入框'
    use.tabIndex = 0
    // mousedown 的默认动作是把焦点从输入框抢给这个 span，ProseMirror 随即异步恢复它
    // 自己记住的光标；处理器里同步的 focus+全选+paste 会输在这场竞态里，整段被编辑器
    // 回滚、只剩兜底 insertText 的首字母。阻止默认动作后点击只触发处理器，不动编辑器。
    use.addEventListener('pointerdown', (e) => e.preventDefault())
    use.addEventListener('mousedown', (e) => e.preventDefault())
    use.addEventListener('click', () => void adapter.setInputText(result.translation))
    layer.appendChild(use)
  }

  const onInput = (): void => {
    if (!state.sendLangSetting.enabled || !state.previewEnabled) {
      hide()
      return
    }
    const input = adapter.getInputElement()
    const text = input ? adapter.getInputText() : ''
    if (!text || text === lastText) {
      if (!text) hide()
      return
    }
    lastText = text
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(async () => {
      const target = adapter.getInputElement()
      if (!target) return
      layer = ensureLayer()
      place(target)
      const result = await requestTranslate(injector, {
        text,
        type: 'send',
        input: true,
        chatHint: adapter.chatHint()
      })
      if (result) paint(result)
      else hide()
    }, TRANSLATE_THROTTLE_TIME)
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // 自己转发出去的那次 Enter 必须放行给平台，否则「先译再发」会自我循环。
    if ((e as KeyboardEvent & Record<string, unknown>)[FORWARDED_ENTER]) return
    const input = adapter.getInputElement()
    const text = input ? adapter.getInputText() : ''
    if (!input || !text) return

    if (state.disableChinese && state.disableChinesePreventSend) {
      // The preview already tells us; block before WhatsApp sees the Enter.
      if (/[\u4e00-\u9fa5]/.test(text)) {
        e.preventDefault()
        e.stopPropagation()
        layer = ensureLayer()
        place(input)
        layer.style.display = 'block'
        layer.textContent = '消息含中文，已拦截发送'
        return
      }
    }
    if (!state.sendLangSetting.enabled || !state.enterToSend) return

    e.preventDefault()
    e.stopPropagation()
    void (async () => {
      // 输入框里的草稿就是发给此刻这个会话的，所以「先译再发」与预览一样带会话提示：
      // 生效面 ② 对它同样成立（记录页回复框那条走的是 ①，与本文件无关）。
      const result = await requestTranslate(injector, {
        text,
        type: 'send',
        chatHint: adapter.chatHint()
      })
      if (!result) return
      await adapter.setInputText(result.translation)
      const forwarded = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      })
      Object.defineProperty(forwarded, FORWARDED_ENTER, { value: true })
      adapter.getInputElement()?.dispatchEvent(forwarded)
    })()
  }

  const root = document.body
  root.addEventListener('input', onInput, true)
  root.addEventListener('keydown', onKeydown, true)

  /**
   * 空了就收起。只挂在 input 上不够：这类富文本输入框由页面自己接管退格——
   * 按键被处理器消化、DOM 由框架改写，不会产生 input 事件，浮层就会把旧译文一直挂着。
   * keyup 覆盖「用户逐字删/全选删」，MutationObserver 覆盖「页面代改」（发送后清空、右键删除）。
   */
  const hideIfEmpty = (): void => {
    const input = adapter.getInputElement()
    if (!input || !adapter.getInputText()) hide()
  }
  root.addEventListener('keyup', hideIfEmpty, true)

  const composerWatcher = new MutationObserver(hideIfEmpty)
  let watched: HTMLElement | null = null
  const watchComposer = (): void => {
    const input = adapter.getInputElement() ?? null
    if (input === watched) return
    composerWatcher.takeRecords()
    watched = input
    if (input) composerWatcher.observe(input, { childList: true, characterData: true, subtree: true })
  }
  watchComposer()
  root.addEventListener('input', watchComposer, true)
  root.addEventListener('keyup', watchComposer, true)

  return () => {
    stopped = true
    if (debounce) clearTimeout(debounce)
    root.removeEventListener('input', onInput, true)
    root.removeEventListener('keydown', onKeydown, true)
    root.removeEventListener('keyup', hideIfEmpty, true)
    root.removeEventListener('input', watchComposer, true)
    root.removeEventListener('keyup', watchComposer, true)
    composerWatcher.disconnect()
    document.getElementById(PREVIEW_ID)?.remove()
  }
}
