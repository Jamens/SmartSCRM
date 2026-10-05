/**
 * 内存/性能监控（A7）——主进程采样端。
 *
 * 采的是**主进程自己**这一个进程的运行时指标（`process.memoryUsage/cpuUsage/uptime`）。
 * 渲染层的 JS 堆不在这里——它由 V8 管在渲染进程里，跨进程读不到也不该猜；这张卡
 * 明说是"应用主进程"视角。纯格式化（字节/时长/行序）在 `@shared/perf`，那里有单测。
 */
import type { PerfMetrics } from '@shared/perf'

/** 取一次主进程指标。`cpuUsage()` 返回微秒，这里换算成秒再交出去。 */
export function readPerfMetrics(): PerfMetrics {
  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    uptimeSec: process.uptime(),
    cpuUserSec: cpu.user / 1_000_000,
    cpuSystemSec: cpu.system / 1_000_000
  }
}
