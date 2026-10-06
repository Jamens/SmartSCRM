/**
 * B20 自动化任务面板的纯规则（配 node --test）。
 *
 * 这个模块的核心易错点（spec §8）：**四类任务的"属于哪个账号"字段形态不一致**——
 * B8/B18/B19 是标量 `accountId`，**B9 养号是多账号 `accountIds` JSON 数组**。
 * 统计"某账号挂几个任务"若只按标量比，会**整类漏掉 B9**。所以统一在这里收口。
 */

/** 任务来源。 */
export type AutomationKind = 'script' | 'nurture' | 'groupJoin' | 'groupKick'

/** 面板里的一条任务（已归一：accountIds 总是数组）。 */
export interface AutomationTask {
  id: number
  kind: AutomationKind
  status: string
  /** 归属账号。B9 是多账号，这里是展开后的数组。 */
  accountIds: number[]
}

/**
 * 解析归属账号 → 数字数组。同时吃标量与 JSON 数组文本：
 * 传 `3` 或 `"3"` → `[3]`；传 `"[2,6,7]"` → `[2,6,7]`；脏数据跳过不抛。
 */
export function toAccountIds(raw: unknown): number[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n))
  }
  if (typeof raw === 'number') return [raw]
  const s = String(raw).trim()
  if (!s) return []
  // JSON 数组形态："[2,6,7]"
  if (s.startsWith('[') && s.endsWith(']')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((x) => Number(x.trim().replace(/^"|"$/g, '')))
      .filter((n) => Number.isFinite(n))
  }
  const n = Number(s.replace(/^"|"$/g, ''))
  return Number.isFinite(n) ? [n] : []
}

/** 某账号命中的任务数（跨所有来源）。 */
export function countTasksByAccount(tasks: AutomationTask[], accountId: number): number {
  return (tasks ?? []).filter((t) => (t.accountIds ?? []).includes(accountId)).length
}

/** 按来源 + 状态交叉计数：→ `{ [kind]: { [status]: count } }`。 */
export function aggregateTaskStatus(
  tasks: AutomationTask[]
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const t of tasks ?? []) {
    const byKind = (out[t.kind] ??= {})
    byKind[t.status] = (byKind[t.status] ?? 0) + 1
  }
  return out
}

/** 终态（不该再视为"在跑"）：与各模块词表一致。 */
const TERMINAL = new Set(['done', 'error', 'cancelled'])

/** 任务是否"在跑"（非终态）。删除/关闭时只有这些需要先停。 */
export function isActiveTask(t: AutomationTask): boolean {
  return !TERMINAL.has(t.status)
}

/** 某账号上在跑的任务（删除/关闭时要先停的那些）。 */
export function activeTasksOfAccount(tasks: AutomationTask[], accountId: number): AutomationTask[] {
  return (tasks ?? []).filter((t) => isActiveTask(t) && (t.accountIds ?? []).includes(accountId))
}

/** 有在跑任务 → 删除前必须先停（spec §5）。纯判定便于单测。 */
export function shouldStopBeforeDelete(activeCount: number): boolean {
  return activeCount > 0
}
