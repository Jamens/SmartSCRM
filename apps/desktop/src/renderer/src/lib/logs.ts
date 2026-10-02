import { useCallback, useEffect, useState } from 'react'
import type { LogCategory, LogEntry, LogLevel } from '@shared/log'

/**
 * 日志中心（A19）的渲染层这一段。
 *
 * 日志是**主进程内存环**的快照，渲染层只拉最新的 N 条来展示，不持有权威数据。
 * 用轮询（每 2s 一次）+ 手动刷新，而不是订阅——日志是排查用的，不是实时仪表盘，
 * 2s 延迟完全可以接受，也省得每条日志都推一次 IPC。
 */

const POLL_MS = 2000

export interface UseLogsResult {
  entries: LogEntry[]
  loading: boolean
  host: 'electron' | 'browser'
  refresh: () => void
  clear: () => void
  openFolder: () => void
}

export function useLogs(category: LogCategory | 'all', level: LogLevel | 'all'): UseLogsResult {
  // loading 初值按宿主定：浏览器预览没有主进程，直接 false，effect 里不再同步 setState。
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(() => !!window.scrm)
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  const pull = useCallback(() => {
    if (!window.scrm) return
    const filter = { category, level, limit: 1000 }
    void window.scrm.logs
      .list(filter)
      .then((rows) => setEntries(rows))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [category, level])

  useEffect(() => {
    if (!window.scrm) return
    pull()
    const timer = setInterval(pull, POLL_MS)
    return () => clearInterval(timer)
  }, [pull])

  const clear = useCallback((): void => {
    if (!window.scrm) return
    void window.scrm.logs.clear().then(pull, () => undefined)
  }, [pull])

  const openFolder = useCallback((): void => {
    void window.scrm?.logs.openFolder()
  }, [])

  return { entries, loading, host, refresh: pull, clear, openFolder }
}
