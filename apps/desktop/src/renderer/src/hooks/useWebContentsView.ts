import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { viewService } from '@/services/viewService'
import { subscribeOverlay } from '@/services/viewOverlay'

export interface ActiveView {
  viewId: string
  url: string
  /** Channel key for the injected bundle; when set, the view is injected after it is ready. */
  channel?: string
  /** Config forwarded to `__SCRM_INJECT__`. */
  injectConfig?: Record<string, unknown>
}

/**
 * Binds a React-measured placeholder to a main-process WebContentsView:
 * creates/shows the embedded page, injects the SCRM bundle when requested,
 * then keeps its bounds locked to the container via ResizeObserver.
 */
export function useWebContentsView(
  containerRef: RefObject<HTMLElement | null>,
  active: ActiveView | null
): { loading: boolean; reload: () => void } {
  const [loading, setLoading] = useState(false)
  const boundsRef = useRef<() => void>(() => {})

  const syncBounds = useCallback((): void => {
    const el = containerRef.current
    if (!el || !active) return
    const rect = el.getBoundingClientRect()
    void viewService.setBounds(active.viewId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
  }, [containerRef, active])

  boundsRef.current = syncBounds

  useEffect(() => {
    if (!active) {
      void viewService.hideAll()
      return
    }
    let cancelled = false
    const { viewId, url, channel, injectConfig } = active

    void (async () => {
      setLoading(true)
      await viewService.create(viewId, url)
      if (cancelled) return
      await viewService.show(viewId)
      boundsRef.current()
      if (channel && injectConfig) {
        await viewService.inject(viewId, channel, injectConfig)
      }
    })()

    const unsubscribe = viewService.onState((state) => {
      if (state.viewId !== viewId) return
      if (state.event === 'ready') setLoading(false)
      else if (state.event === 'loading') setLoading(true)
      else boundsRef.current()
    })

    const observer = new ResizeObserver(() => boundsRef.current())
    if (containerRef.current) observer.observe(containerRef.current)
    window.addEventListener('resize', boundsRef.current)

    return () => {
      cancelled = true
      unsubscribe()
      observer.disconnect()
      window.removeEventListener('resize', boundsRef.current)
      if (channel) void viewService.uninject(viewId)
      // 内嵌视图是主进程里的原生层，永远画在文档之上，DOM 的卸载带不走它：
      // 舞台一消失（切路由、退出登录）就必须主动收起，否则它会留在原坐标盖住别的页面。
      void viewService.hideAll()
    }
  }, [active?.viewId, active?.url, active?.channel, containerRef])

  // 对话框这类浮层打开时收起视图，浮层完全消失后再把视图放回舞台原位。
  const activeViewId = active?.viewId
  useEffect(() => {
    if (!activeViewId) return
    return subscribeOverlay((open) => {
      if (open) {
        void viewService.hideAll()
        return
      }
      void (async () => {
        await viewService.show(activeViewId)
        boundsRef.current()
      })()
    })
  }, [activeViewId])

  const reload = useCallback((): void => {
    if (!active) return
    setLoading(true)
    void viewService.reload(active.viewId)
  }, [active])

  return { loading, reload }
}
