// src/shared/chatTime.ts
/**
 * 聊天记录的时间口径。后端写库与读库的墙钟固定在东八区（`MsgTimes.CHAT_ZONE`，与 JDBC URL 上的
 * `serverTimezone=Asia/Shanghai` 是一对），Jackson 出来的 `msg_time` 是**不带偏移**的串。
 * 于是两条边都要钉住同一个区：
 *
 * - 解析（串 → instant）：`chatMs()` 补上本文件的 `CHAT_ZONE_OFFSET_TAG`；
 * - 格式化（instant → 日键 / 时刻）：本文件的 `chatDayKey()` / `chatClock()`。
 *
 * 只做前者会留下一个隐蔽的错：instant 是对的，但 `dayjs(instant).format()` 按浏览器时区显示，
 * 于是"哪天"由机器决定。日分组、日头文案、统计卡的 `perDay` 三处必须切在同一条日界上，
 * 而 `perDay` 是后端按 `DATE(msg_time)` 算的——页面用自己那套日界去对它的天数，非东八区的机器
 * 上必然差出边界那几个小时。所以格式化也只能按写库那个区。
 *
 * 这里不用 dayjs：日键与时刻都从 `getUTC*()` 读，先把 instant 平移到东八区的 UTC 轴上。
 * 少一个依赖也少一处"插件没 extend 就静默按本地区"的坑（`utcOffset()` 需要 utc 插件）。
 */

/** 写库那个区的偏移分钟数；`MsgTimes.CHAT_ZONE` 的 TS 侧对应物。 */
export const CHAT_ZONE_OFFSET_MIN = 480

/** 同一个区的 ISO 偏移标签，解析墙钟串时补在它末尾。 */
export const CHAT_ZONE_OFFSET_TAG = '+08:00'

const MS_PER_MIN = 60_000
const MS_PER_DAY = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')

/** 平移到"东八区当作 UTC"的轴上，之后一律读 `getUTC*()`。 */
const shifted = (ms: number): Date => new Date(ms + CHAT_ZONE_OFFSET_MIN * MS_PER_MIN)

/**
 * instant → 东八区日键 `YYYY-MM-DD`。既是 React key，也是日分组的切分依据，
 * 还与 `dayLabel()` 的入参同一个形状。
 */
export function chatDayKey(ms: number): string {
  const d = shifted(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** instant → 东八区 `HH:mm`。日分组已经交代了"哪天"，这里只到分。 */
export function chatClock(ms: number): string {
  const d = shifted(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * 日键的前一天。入参是日键不是 instant，所以只能在"日键 → UTC 轴上的整日刻度"上减一天，
 * 再读回 UTC 分量：用 `new Date('2026-03-01')` 这类本地解析的话，机器时区会把日界挪半天，
 * 月初/年初的"昨天"正是它最容易错的地方。
 */
export function chatDayBefore(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const prev = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) - MS_PER_DAY)
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`
}

/** 日键的分量：`M月D日` / `YYYY年M月D日` 这类文案由调用方拼，这里只保证拆出来的数按东八区。 */
export function chatDayParts(dayKey: string): { year: number; month: number; day: number } {
  const [y, m, d] = dayKey.split('-').map(Number)
  return { year: y ?? 0, month: m ?? 0, day: d ?? 0 }
}
