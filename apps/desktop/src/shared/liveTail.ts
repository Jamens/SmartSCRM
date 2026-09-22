// src/shared/liveTail.ts
import { canAdvance } from './chatStatus.ts'
import type { MsgStatus } from './chatTypes.ts'

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

/**
 * 状态取哪一份。两条源各自只是"某个时刻的快照"，谁都不必然更新，但阶梯只能向上
 * （`canAdvance` 与后端 `advanceStatus` 的 `FIELD()` 同形），所以"更靠后的那个"就是
 * 合起来能给出的最好答案。两个方向都要问：库行已经 `read` 而尾巴那一行还停在 `pending`
 * 是常态——状态帧只推尾巴里已经有的那一行（见 `advanceStatus` 的不新增规矩），所以尾巴
 * 被 `gcTime` 收走过、或 ack 比 live 帧更早到时，库里那份才是新的；只看尾巴会把这行
 * 永久冻在 `pending`。反过来尾巴先到 `read`、库页还停在上一次翻页的 `sent` 时也不能倒退。
 * 两边都推进不了时保留第一个参数——`failed` 与 `received` 不在阶梯里，正是由这条兜底决定归属。
 */
export function furtherStatus(current: MsgStatus, incoming: MsgStatus): MsgStatus {
  if (canAdvance(current, incoming)) return incoming
  if (canAdvance(incoming, current)) return current
  return current
}

/**
 * 一批键的状态推进：ack 状态帧的落点（`msgBridge` 广播 `msg:status` → 渲染层写尾巴）。
 * 返回 `{ rows, changed }`，`changed` = 真的往上走了几条。三条规矩，缺一会出肉眼可见的错：
 * 1) 找不到对应键的行**不新增**——一帧 ack 只带键与状态，没有正文与方向，凑出来的
 *    "幽灵气泡"会在窗口顶上挂一条空白行（与 `mergeTail` 规则 2、`settlePending` 的
 *    不新增闸同一个立场）；
 * 2) 只允许向上（`furtherStatus`）——推不动的行保持原值。`failed` 是唯一能落定的阶梯外目标，
 *    且只从 pending/sent 落定（`canAdvance` 那条例外分支，与后端同形）；`received` 谁也动不了；
 * 3) `changed` 数的是**真的变了**的行数，不是命中数——重复 ack 命中已经到位的行必须算 0，
 *    否则调用方拿到的"这一帧推进了几条"就只是"这一帧带了几条键"，没有信息量。
 * 入参数组不被修改（返回新数组），命中行按 `mergeTail` 的现有风格返回新对象。
 */
export function advanceStatus<T extends TailRow & { status: MsgStatus }>(
  rows: readonly T[],
  msgKeys: readonly string[],
  status: MsgStatus
): { rows: T[]; changed: number } {
  const out: T[] = [...rows]
  let changed = 0
  for (const msgKey of msgKeys) {
    const at = out.findIndex((r) => r.msgKey === msgKey)
    if (at < 0) continue
    const from = out[at].status
    const next: T = { ...out[at], status: furtherStatus(from, status) }
    out[at] = next
    if (next.status !== from) changed++
  }
  return { rows: out, changed }
}
