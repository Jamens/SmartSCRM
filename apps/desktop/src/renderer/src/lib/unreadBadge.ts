import { useCallback, useEffect, useRef, useState } from 'react'
import { useUnreadTotal } from '@/api/messages'
import { badgeCountOf, type BadgeEcho } from '@shared/badge'

/**
 * 任务栏未读角标的渲染层这一段。
 *
 * 分工按"谁知道什么"切：未读总量只有后端知道，开关只有主进程落盘，前台/后台只有这里知道，
 * 而真正会画的是主进程那两条平台 API（`app.setBadgeCount` / `setOverlayIcon`）。
 * 所以这里只负责把三样东西合成一个整数推过去，规则本身在 `@shared/badge`（有单测）。
 */

/** 主进程读不到时的取值：与 `DEFAULTS.badgeEnabled` 同一个默认（开着的开关不用等落盘才亮）。 */
const BADGE_DEFAULT = true

/**
 * 「任务栏未读角标」开关。档位存在主进程（与主题同一份 `scrm-settings.json`），这里只是它的一个客户端：
 * 读初值 → 订阅广播 → 写的时候以主进程回的那份为权威值。
 *
 * 两个消费者各自持有一份 state（下面 `useUnreadBadge` 与设置页那个 Switch），靠 `settings:changed` 对齐，
 * 不做全局 store：一个布尔值不值得多一层，而且 Q2 的主题已经是同一套做法。
 */
export function useBadgeEnabled(): {
  enabled: boolean
  /** electron = 开关能落盘并由主进程广播；browser = 纯浏览器预览，这里没有任务栏可画。UI 据此说实话。 */
  host: 'electron' | 'browser'
  setEnabled: (next: boolean) => void
} {
  const [enabled, setEnabled] = useState(BADGE_DEFAULT)
  // 只在挂载时判一次：`window.scrm` 由 preload 在文档脚本之前挂好，运行中不会变化。
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  useEffect(() => {
    if (!window.scrm) return
    let alive = true
    // 不接住 reject 就是一条未处理拒绝：这一句只是"补一次初值"，读不到就停在默认值上。
    void window.scrm.settings
      .get()
      .then((s) => alive && setEnabled(s.badgeEnabled))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.settings.onChanged((s) => setEnabled(s.badgeEnabled))
  }, [])

  const write = useCallback((next: boolean): void => {
    // 先按点下去的值翻，再用主进程的回包与广播纠正：开关点了不动比晚一拍更糟。
    setEnabled(next)
    const done = (s: { badgeEnabled: boolean }): void => setEnabled(s.badgeEnabled)
    window.scrm?.settings
      .set({ badgeEnabled: next })
      .then(done)
      // 写失败（文件被占用等）就把主进程那份读回来，别让界面停在一个没落地的值上。
      .catch(() => {
        void window.scrm?.settings.get().then(done, () => undefined)
      })
  }, [])

  return { enabled, host, setEnabled: write }
}

/**
 * 窗口此刻在前台吗。`document.hasFocus()` 单独不够：窗口最小化时它确实是 false，
 * 但"被别的窗口盖住"和"系统层面失焦"之间还差一次 `visibilitychange`，
 * 而这两个状态要的角标行为相同（都不该报 0），所以两条一起读、任一为假即失焦。
 */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(
    () => document.visibilityState === 'visible' && document.hasFocus()
  )
  useEffect(() => {
    const sync = (): void =>
      setFocused(document.visibilityState === 'visible' && document.hasFocus())
    // 每个事件都全量重读而不是各自写 true/false：`focus` 与 `visibilitychange` 的到达顺序
    // 不保证（最小化时 blur 可能排在 hidden 之后），按事件写会留下一个反了的状态。
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return focused
}

/** 一次推送的结果：回执，或者主进程抛出来的那句原文。探针两种都要能读，缺一个就没法区分"没生效"与"报错了"。 */
interface BadgeWrite {
  echo: BadgeEcho | null
  error: string | null
}

/** 控制台探针（dev）：`__q1` 让 A 档能断言规则本身，而不只是"没报错"。生产构建里整块不存在。 */
interface Q1Probe {
  count: () => number
  /** 传给主进程的那三个输入，直接读出来才对得上 `badgeCountOf` 的判定。 */
  input: () => { enabled: boolean; focused: boolean; total: number | null }
  last: () => BadgeWrite | null
}

/**
 * 角标写入串行化。
 *
 * `count` 一变就 invoke 一次，而 invoke 的**完成顺序不保证与发起顺序一致**：
 * 连着"来消息 → 抢焦点"时，慢的那个 `setOverlayIcon` 后落地就会把新的 0 盖回红点。
 * 这里只留"最近该报的值"（`wanted`），由一个循环按序排空：中途改了几次都不重要，
 * 每一轮取到的都是当时最新的那个，最后一次写入必然落在最终值上。
 */
export function useUnreadBadge(): void {
  const { enabled } = useBadgeEnabled()
  const focused = useWindowFocused()
  const { data } = useUnreadTotal()
  const total = data?.total ?? null
  const count = badgeCountOf({ enabled, focused, total })

  const wanted = useRef<number | null>(null)
  const draining = useRef(false)
  const last = useRef<BadgeWrite | null>(null)

  useEffect(() => {
    const api = window.scrm
    // 纯浏览器预览（没有主进程）时整段空转：角标是系统托盘级别的东西，浏览器里画不出来。
    if (!api) return
    wanted.current = count
    if (draining.current) return
    draining.current = true
    void (async () => {
      while (wanted.current !== null) {
        const next = wanted.current
        wanted.current = null
        try {
          last.current = { echo: await api.badge.set(next), error: null }
        } catch (e) {
          // 留错误原文而不是伪造一个回执：驱动读到 `echo:null` 就是要断言的那种失败。
          last.current = { echo: null, error: String(e) }
        }
      }
      draining.current = false
    })()
  }, [count])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __q1?: Q1Probe }
    w.__q1 = {
      count: () => count,
      input: () => ({ enabled, focused, total }),
      last: () => last.current
    }
    return () => {
      delete w.__q1
    }
  }, [count, enabled, focused, total])
}
