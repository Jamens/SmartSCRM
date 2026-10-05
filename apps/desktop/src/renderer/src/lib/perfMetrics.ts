/**
 * 内存/性能监控（A7）的渲染层这一段。
 *
 * 数据源是主进程（`window.scrm.app.getPerfMetrics()`），没有主进程（纯浏览器预览）时给
 * `null`，由 `@shared/perf` 把每行铺成「未知」——不显示 0，因为 0 与"没采到"在界面上
 * 必须能分辨。这几个数会自己变，所以按 `refetchInterval` 轮询（3s）而不是 `staleTime: Infinity`。
 */
import { useQuery } from '@tanstack/react-query'
import { perfRows, type PerfMetrics, type PerfRow } from '@shared/perf'

const KEY = ['device', 'perf-metrics'] as const

async function readPerf(): Promise<PerfMetrics | null> {
  return (await window.scrm?.app.getPerfMetrics()) ?? null
}

export interface PerfInfo {
  rows: PerfRow[]
  loading: boolean
}

/** 性能监控卡的数据。挂在设置页时按 3s 轮询。 */
export function usePerfMetrics(): PerfInfo {
  const q = useQuery({
    queryKey: KEY,
    queryFn: readPerf,
    refetchInterval: 3000
  })
  return {
    rows: perfRows(q.data),
    loading: q.isPending
  }
}
