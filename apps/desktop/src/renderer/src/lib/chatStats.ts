// src/renderer/src/lib/chatStats.ts
import dayjs from 'dayjs'

/** 与 Task 4 的 `DayCountVO` 同形（闸门里不 import `@/api/messages`）。 */
export interface DayCountShape {
  day: string
  inCount: number
  outCount: number
}

export interface DayBar {
  day: string
  /** 柱子底下那行小字：`9/20`。 */
  label: string
  inCount: number
  outCount: number
  total: number
  /** 柱高：窗口内当日最大总量为 100%；全零时是 0，不是 NaN。 */
  heightPct: number
  /** 柱内两段各占这一根柱子的多少；`total` 为 0 时都是 0，否则两者相加恒等于 100。 */
  inShare: number
  outShare: number
}

/**
 * 柱条永远只画最近这么多根：`days=30` 时 30 根在这个宽度下读不出差别，
 * 而"这周有没有量"才是销售要看的那件事。所以数字窗口（7/30 切换）与柱条窗口分开。
 */
export const BAR_DAYS = 7

/**
 * 补零是后端的职责（Task 4：`perDay.length` 恒等于 `days`），这里只做三件事：
 * 切末尾 `windowDays` 根（**再多也只到 `BAR_DAYS`**——数字窗口切到 30 天时柱子不跟着变密，
 * 见上面那条注释）、按最大量归一、把 `YYYY-MM-DD` 变成小字。
 * 万一哪天没补上就照实少画一根——客户端再补一份零，两处补法迟早对不上。
 */
export function toBars(perDay: readonly DayCountShape[], windowDays: number = BAR_DAYS): DayBar[] {
  const rows = perDay.slice(-Math.min(Math.max(windowDays, 1), BAR_DAYS))
  const peak = rows.reduce((max, r) => Math.max(max, r.inCount + r.outCount), 0)
  return rows.map((row) => {
    const total = row.inCount + row.outCount
    const inShare = total === 0 ? 0 : Math.round((row.inCount / total) * 100)
    return {
      day: row.day,
      label: dayjs(row.day).format('M/D'),
      inCount: row.inCount,
      outCount: row.outCount,
      total,
      heightPct: peak === 0 ? 0 : Math.round((total / peak) * 100),
      inShare,
      outShare: total === 0 ? 0 : 100 - inShare
    }
  })
}

/** 「收 / 发」占比文案：分母为 0 时给「—」，不给 `NaN%`。 */
export function shareOf(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${Math.round((part / total) * 100)}%`
}
