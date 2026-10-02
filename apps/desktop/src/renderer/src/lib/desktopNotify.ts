import { useCallback, useEffect, useRef, useState } from 'react'
import { useWindowFocused } from '@/lib/unreadBadge'
import { titleOfConversation } from '@/lib/chatDisplay'
import type { LiveFrame } from '@shared/chatTypes'
import type { NotifyShowRequest } from '@shared/notification'

/**
 * 桌面系统通知（A17）的渲染层这一段。
 *
 * 分工按"谁知道什么"切，与 `lib/unreadBadge.ts` 同一套理由：
 * 入站帧什么时候来、开关在不在、窗口有没有焦点，只有渲染层齐全；
 * 跨帧合并与真的弹窗只有主进程能做（那里的注释写了为什么去抖不能放渲染层）。
 * 所以这里只负责把一帧摊平成一份请求并提请，规则本身在 `@shared/notification`。
 */

/** 与 `DEFAULTS.notificationEnabled` 同一个默认（开着的开关不用等落盘才生效）。 */
const NOTIFY_DEFAULT = true

/**
 * 「桌面消息通知」开关。与角标开关是**两份独立的 state**，各读各的 `settings:changed`——
 * 一个布尔值不值得做全局 store，而它们本来就是两个互不牵连的开关。
 */
export function useNotifyEnabled(): {
  enabled: boolean
  /** electron = 开关能落盘并由主进程广播；browser = 纯浏览器预览，这里没有系统通知可弹。 */
  host: 'electron' | 'browser'
  setEnabled: (next: boolean) => void
} {
  const [enabled, setEnabled] = useState(NOTIFY_DEFAULT)
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  useEffect(() => {
    if (!window.scrm) return
    let alive = true
    void window.scrm.settings
      .get()
      .then((s) => alive && setEnabled(s.notificationEnabled))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.settings.onChanged((s) => setEnabled(s.notificationEnabled))
  }, [])

  const write = useCallback((next: boolean): void => {
    setEnabled(next)
    const done = (s: { notificationEnabled: boolean }): void => setEnabled(s.notificationEnabled)
    window.scrm?.settings
      .set({ notificationEnabled: next })
      .then(done)
      .catch(() => {
        void window.scrm?.settings.get().then(done, () => undefined)
      })
  }, [])

  return { enabled, host, setEnabled: write }
}

/**
 * 一帧入站消息 → 提请弹窗。
 *
 * 返回值是稳定的：订阅方（`useLiveTailSync`）不必因为开关或焦点变化而重新订阅。
 * 所以开关与焦点走 ref 读最新值，而 ref 只在 effect 里赋值——渲染期写 ref 会被
 * `react-hooks/refs` 拦下，也是真的会在并发渲染下读到半截状态。
 */
export function useIncomingNotifier(): (frame: LiveFrame) => void {
  const { enabled } = useNotifyEnabled()
  const focused = useWindowFocused()
  const live = useRef({ enabled, focused })

  useEffect(() => {
    live.current = { enabled, focused }
  }, [enabled, focused])

  return useCallback((frame: LiveFrame): void => {
    const api = window.scrm
    // 纯浏览器预览（没有主进程）时整段不提请：系统通知是宿主级能力，浏览器里弹不出来。
    if (!api) return
    const m = frame.message
    const req: NotifyShowRequest = {
      enabled: live.current.enabled,
      focused: live.current.focused,
      direction: m.direction,
      chatKey: m.chatKey,
      // 帧里有会话名就用，没有就退回号码前缀——不伪装成一个名字。
      title: titleOfConversation({ title: m.chatTitle ?? '', chatKey: m.chatKey }),
      body: m.body ?? '',
      accountId: frame.accountId
    }
    // 回执是"排进去了"而不是"弹了"：合并窗口到点才真弹。这里不判定成败，也不提示。
    void api.notify.show(req).catch(() => undefined)
  }, [])
}

/**
 * 通知点击后的落点订阅。回调里做什么由调用方决定（AppLayout 负责跳到消息页）。
 *
 * 用 ref 持有回调而不是把它放进订阅的 deps：跳转函数每天都可能被换成新的闭包，
 * 放进 deps 会让每次渲染都解绑重绑一次 IPC 监听。
 */
export function useNotifyJump(onJump: (target: { accountId: number; chatKey: string }) => void): void {
  const pending = useRef(onJump)
  useEffect(() => {
    pending.current = onJump
  }, [onJump])

  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.notify.onClicked((target) => pending.current(target))
  }, [])
}
