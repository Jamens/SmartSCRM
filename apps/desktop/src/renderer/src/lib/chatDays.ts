// src/renderer/src/lib/chatDays.ts
// 相对路径 + `.ts` 后缀是闸门要求的：本文件被 `node --test` 直接跑，Node 不认 `@shared/*` 别名
// （msgBridge 那几份进闸门的文件同一个写法）。非闸门文件照旧用 `@shared/chatTime`。
import { chatClock, chatDayBefore, chatDayKey, chatDayParts } from '../../../shared/chatTime.ts'

/** `day` 是东八区日键（`chatDayKey` 的形状），同时当 React key 用：它稳定、可比、可读。 */
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
    const day = chatDayKey(row.ts)
    const last = out[out.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else out.push({ day, rows: [row] })
  }
  return out
}

/**
 * 同一个文案规则服务两处：日头（`dayLabel`）与列表右侧的绝对时间（`listTime`）。
 * 年份比较用日键自己拆出来的数，不解析成 Date——解析就会再引入一次"哪个区"的问题。
 */
function absoluteDayLabel(day: string, todayKey: string): string {
  const { year, month, day: dom } = chatDayParts(day)
  const text = `${month}月${dom}日`
  return year === chatDayParts(todayKey).year ? text : `${year}年${text}`
}

/** 日头文案（spec §8 的"日分组"）。`day` 是 `chatDayKey` 出来的日键。 */
export function dayLabel(day: string, nowMs: number = Date.now()): string {
  const todayKey = chatDayKey(nowMs)
  if (day === todayKey) return '今天'
  if (day === chatDayBefore(todayKey)) return '昨天'
  return absoluteDayLabel(day, todayKey)
}

/**
 * 会话列表右侧的时间。比 `dayLabel` 多两级："刚刚 / N分钟前"，因为销售在一眼里要判断
 * "这条会话是不是刚醒"，日期粒度做不到。未来时间兜在"刚刚"，不出现负数。
 */
export function listTime(ts: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}分钟前`
  const todayKey = chatDayKey(nowMs)
  const day = chatDayKey(ts)
  if (day === todayKey) return chatClock(ts)
  if (day === chatDayBefore(todayKey)) return '昨天'
  return absoluteDayLabel(day, todayKey)
}
