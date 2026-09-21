// src/shared/liveTail.ts
/**
 * 记录页的"尾巴"合并：历史读库、live 吃推送，两路在同一个数组里相遇（spec §4 第 5 条）。
 * 只认 msgKey 与 ts 两个字段，所以调用方带什么行形状都行。
 */
export interface TailRow {
  msgKey: string
  ts: number
}

/** 乐观气泡还没有平台 id，用前缀标出来，避免与真实键撞车。 */
export const PENDING_PREFIX = '~'

export function pendingKey(localId: string): string {
  return `${PENDING_PREFIX}${localId}`
}

export function isPendingRow(row: TailRow): boolean {
  return row.msgKey.startsWith(PENDING_PREFIX)
}

/**
 * 并入 live 帧。三条规则，缺一会出肉眼可见的错：
 * 1) 同 msgKey 覆盖不新增——状态推进与"补底 + 实时"交叠；
 * 2) 比窗口头部还旧且没见过的行丢弃——否则上滑翻页时尾巴会往回长；
 * 3) 结果恒按 ts 升序——气泡顺序错乱是最刺眼的 bug。
 */
export function mergeTail<T extends TailRow>(rows: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return [...rows]
  const out: T[] = [...rows]
  const oldest = out.length > 0 ? Math.min(...out.map((r) => r.ts)) : Number.NEGATIVE_INFINITY
  for (const next of incoming) {
    const at = out.findIndex((r) => r.msgKey === next.msgKey)
    if (at >= 0) {
      out[at] = { ...out[at], ...next, ts: Math.max(out[at].ts, next.ts) }
      continue
    }
    if (next.ts < oldest) continue
    out.push(next)
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/**
 * 回执到了：把 `~localId` 那行原地改成真实 msgKey。
 * 气泡已经不在（例如列表刷新把库行拉进来了）时不新增行，只把真实键那行的字段并上。
 */
export function settlePending<T extends TailRow>(
  rows: readonly T[],
  localId: string,
  msgKey: string,
  extra?: Partial<T>
): T[] {
  const key = pendingKey(localId)
  const at = rows.findIndex((r) => r.msgKey === key)
  if (at < 0) return mergeTail(rows, msgKey ? [{ msgKey, ts: 0, ...extra } as T] : [])
  const out = [...rows]
  out[at] = { ...out[at], ...extra, msgKey }
  return out
}
