// src/renderer/src/lib/chatDays.ts
import dayjs from 'dayjs'

const DAY_KEY = 'YYYY-MM-DD'

/** `day` 是本地日键，同时当 React key 用：它稳定、可比、可读。 */
export interface DaySection<T> {
  day: string
  rows: T[]
}

/**
 * 进来的数组正常已由 `mergeTail` 排成升序；这里仍排一次。
 * 分组函数不该把上游的不变量当契约——少排一次序的代价是页面上出现两个同样的日头，
 * 而那个 bug 只会在"补底帧比窗口头更晚到"这种时序里出现，回归时几乎复现不出来。
 */
export function groupByDay<T extends { ts: number }>(rows: readonly T[]): DaySection<T>[] {
  const out: DaySection<T>[] = []
  for (const row of [...rows].sort((a, b) => a.ts - b.ts)) {
    const day = dayjs(row.ts).format(DAY_KEY)
    const last = out[out.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else out.push({ day, rows: [row] })
  }
  return out
}

/** 日头文案（spec §8 的"日分组"）。 */
export function dayLabel(day: string, nowMs: number = Date.now()): string {
  const today = dayjs(nowMs)
  const target = dayjs(day)
  if (target.format(DAY_KEY) === today.format(DAY_KEY)) return '今天'
  if (target.format(DAY_KEY) === today.subtract(1, 'day').format(DAY_KEY)) return '昨天'
  return target.year() === today.year() ? target.format('M月D日') : target.format('YYYY年M月D日')
}

/**
 * 会话列表右侧的时间。比 `dayLabel` 多两级："刚刚 / N分钟前"，因为销售在一眼里要判断
 * "这条会话是不是刚醒"，日期粒度做不到。未来时间兜在"刚刚"，不出现负数。
 */
export function listTime(ts: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}分钟前`
  const at = dayjs(ts)
  const today = dayjs(nowMs)
  if (at.format(DAY_KEY) === today.format(DAY_KEY)) return at.format('HH:mm')
  if (at.format(DAY_KEY) === today.subtract(1, 'day').format(DAY_KEY)) return '昨天'
  return at.year() === today.year() ? at.format('M月D日') : at.format('YYYY年M月D日')
}
