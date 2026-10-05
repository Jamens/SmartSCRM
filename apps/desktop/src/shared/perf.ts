/**
 * 内存/性能监控（A7）的纯模型：主进程取到的运行时指标 → 设置页要画的那几行。
 *
 * 与 `machine.ts` 同构：真正需要"只有一份"的是**数字怎么念**（字节进位成 KB/MB/GB、
 * 秒进位成 Xh Ym）与**这一屏有哪几行、什么顺序**。两者都收在这里并配单测，页面只负责画。
 * 取不到指标时每行说「未知」（复用 machine 的 `UNKNOWN_TEXT`），不显示 0——0 与"没采到"
 * 在界面上必须能分辨。
 */
import { UNKNOWN_TEXT, formatBytes } from './machine.ts'

// formatBytes 直接复用 machine 的那一份（同一套 1024 进位与「未知」口径），不重造。

/** 主进程给的运行时指标。取不到时上层传 `null`，不在这里编 0。 */
export interface PerfMetrics {
  /** 常驻集大小（bytes）——进程实际占着的物理内存。 */
  rss: number
  /** V8 堆上限（bytes）。 */
  heapTotal: number
  /** V8 堆已用（bytes）。 */
  heapUsed: number
  /** 堆外（Buffer 等）（bytes）。 */
  external: number
  /** 进程已运行秒数。 */
  uptimeSec: number
  /** 累计用户态 CPU 秒。 */
  cpuUserSec: number
  /** 累计内核态 CPU 秒。 */
  cpuSystemSec: number
}

export interface PerfRow {
  /** 稳定标识：驱动逐行寻址用，不依赖标签文案。 */
  key: string
  label: string
  value: string
}

/** 秒 → `Xh Ym` / `Ym Zs` / `Zs`。非有限数/负数 → 未知。 */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return UNKNOWN_TEXT
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

/** 累计 CPU 秒（用户+内核）。 */
export function cpuTotalSec(m: PerfMetrics | null | undefined): number | null {
  if (!m || !Number.isFinite(m.cpuUserSec) || !Number.isFinite(m.cpuSystemSec)) return null
  return m.cpuUserSec + m.cpuSystemSec
}

type RowSpec = {
  key: string
  label: string
  read: (m: PerfMetrics | null | undefined) => string
}

/** 行的顺序 = 卡片上的顺序，写死：顺序本身也是要对账的一部分。 */
const ROW_SPECS: RowSpec[] = [
  { key: 'memory.rss', label: '常驻内存 RSS', read: (m) => (m ? formatBytes(m.rss) : UNKNOWN_TEXT) },
  { key: 'memory.heapUsed', label: 'V8 堆已用', read: (m) => (m ? formatBytes(m.heapUsed) : UNKNOWN_TEXT) },
  { key: 'memory.heapTotal', label: 'V8 堆上限', read: (m) => (m ? formatBytes(m.heapTotal) : UNKNOWN_TEXT) },
  { key: 'memory.external', label: '堆外（Buffer）', read: (m) => (m ? formatBytes(m.external) : UNKNOWN_TEXT) },
  { key: 'runtime.uptime', label: '已运行', read: (m) => formatDuration(m?.uptimeSec) },
  { key: 'cpu.total', label: '累计 CPU', read: (m) => formatDuration(cpuTotalSec(m)) }
]

/** 把指标铺成卡片行；`null` 指标时每行都是「未知」。 */
export function perfRows(m: PerfMetrics | null | undefined): PerfRow[] {
  return ROW_SPECS.map((s) => ({ key: s.key, label: s.label, value: s.read(m) }))
}
