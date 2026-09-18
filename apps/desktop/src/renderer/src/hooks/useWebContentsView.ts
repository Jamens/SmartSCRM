import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { viewService } from '@/services/viewService'

export interface ActiveView {
  viewId: string
  url: string
}

/**
 * Binds a React-measured placeholder to a main-process WebContentsView:
 * creates/shows the embedded page, then keeps its bounds locked to the
 * container through ResizeObserver + window resize events.
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
    const { viewId, url } = active

    void (async () => {
      setLoading(true)
      await viewService.create(viewId, url)
      if (cancelled) return
      await viewService.show(viewId)
      boundsRef.current()
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
    }
  }, [active?.viewId, active?.url, containerRef])

  const reload = useCallback((): void => {
    if (!active) return
    setLoading(true)
    void viewService.reload(active.viewId)
  }, [active])

  return { loading, reload }
}
