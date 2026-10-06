/**
 * B9 互聊养号的纯规则（配 node --test）。
 *
 * 「可复现」是这个模块的命门，spec §3 写死了两条铁律，这里是它们的落点：
 *
 * 1. **装箱按稳定顺序**：同一批账号两次装箱必须结果相同。所以按 id 升序排，**不依赖
 *    调用方给的数组顺序、更不依赖 Set 迭代顺序**（后者在不同引擎/不同插入序下会变）。
 * 2. **日程不用 Math.random**：全部用同 seed 的 LCG。同 seed 同输入必得同序列——否则
 *    `last_run_date` 断点存了也接不上（今天跑到第 3 点，明天重算可能变成第 1 点）。
 *
 * 跟 B18/B19 的 `joinIntervalMs` 是同一套可复现随机口径。
 */

/** 参与账号（装箱只需要这两个字段）。 */
export interface PackAccount {
  id: number
  /** 平台标识（如 whatsapp/telegram）：**同平台才可同群**（群 chatKey 属于某个平台）。 */
  platform: string
}

/** 装箱结果：一个群 + 群里的账号。 */
export interface PackedGroup {
  groupIndex: number
  platform: string
  accountIds: number[]
}

/** 与 groupOps/scriptActions 同款 LCG（可复现）。 */
function lcg(seed: number): number {
  const s = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return s / 0x100000000
}

/**
 * 装箱：把账号按平台分组后，每 `perGroup` 个装一箱。
 *
 * - **同平台才可同群**：跨平台账号分属不同箱（跨平台的群 chatKey 根本不存在）。
 * - **稳定排序**：先按平台名排、再按 id 升序——不依赖传入数组顺序，也不依赖 Set 迭代序。
 *   这一点是"可复现"的前提：调用方两次传入顺序不同的同一批账号，结果必须一致。
 * - 尾箱不足 `perGroup` 也成一群（不丢账号）。
 */
export function packAccounts(accounts: PackAccount[], perGroup: number): PackedGroup[] {
  const size = Math.max(1, Math.floor(perGroup) || 1)
  // 稳定排序：**平台按字典序**（保证可复现——不能依赖传入顺序，那会随调用方变），
  // 箱内按 id 升序。平台名排序是确定性的，代价是 whatsapp/telegram 的先后不由人控制；
  // 要人工指定优先级得再加一张平台顺序表，本期不需要。
  const sorted = [...(accounts ?? [])]
    .filter((a) => a && typeof a.id === 'number' && Number.isFinite(a.id) && a.platform)
    .sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : a.id - b.id))

  const out: PackedGroup[] = []
  let cur: PackedGroup | null = null
  for (const a of sorted) {
    // 换平台、或当前箱满了 → 开新箱
    if (!cur || cur.platform !== a.platform || cur.accountIds.length >= size) {
      cur = { groupIndex: out.length, platform: a.platform, accountIds: [] }
      out.push(cur)
    }
    cur.accountIds.push(a.id)
  }
  return out
}

/** 日程上的一个时间点（如 '09:30'）。 */
export interface ScheduleSlot {
  /** 'HH:mm' */
  at: string
  /** 该时间点内的轮次序号，从 0 起。 */
  round: number
}

/** 校验 'HH:mm'；非法返回 null。 */
function parseAt(at: string): { h: number; m: number } | null {
  const mt = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(String(at ?? '').trim())
  return mt ? { h: Number(mt[1]), m: Number(mt[2]) } : null
}

/**
 * 展开某一天的日程：时间点 × 轮次 → 有序槽位（按时间升序）。
 * 非法 'HH:mm' 直接跳过（不抛——一个时间点写错不该让整张计划跑不起来）。
 */
export function planSchedule(atPoints: string[], speakingRounds: number): ScheduleSlot[] {
  const rounds = Math.max(0, Math.floor(speakingRounds) || 0)
  const valid = (atPoints ?? [])
    .map((a) => ({ raw: String(a ?? '').trim(), p: parseAt(a) }))
    .filter((x) => x.p != null)
    .sort((a, b) => (a.p!.h * 60 + a.p!.m) - (b.p!.h * 60 + b.p!.m))
  const out: ScheduleSlot[] = []
  for (const v of valid) {
    for (let r = 0; r < rounds; r++) {
      out.push({ at: v.raw, round: r })
    }
  }
  return out
}

/** 'HH:mm' → 当日分钟数；非法返 -1。 */
export function atMinutes(at: string): number {
  const p = parseAt(at)
  return p == null ? -1 : p.h * 60 + p.m
}

/**
 * 轮内发言顺序：把群内账号按 seed **可复现洗牌**。
 *
 * 为什么要洗牌：若永远按 id 升序发言，群里会看出固定模式（1 号总是先说），不像真人。
 * 用同 seed 的 Fisher–Yates 而不是 sort(() => Math.random()-0.5)（那个不可复现）。
 * **不修改入参**。
 */
export function speakingOrder(accountIds: number[], seed: number, groupIndex = 0): number[] {
  const out = [...(accountIds ?? [])]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(lcg(seed * 7919 + groupIndex * 104729 + i * 2654435761) * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

/**
 * 本次发言间隔（毫秒）：[minSec, maxSec] 内随机 + ±jitterPct 抖动。
 * 与 B18/B19 的 joinIntervalMs 同口径（**可复现** LCG），索引 index 让不同轮次拿到不同间隔。
 */
export function speakIntervalMs(
  index: number,
  minSec: number,
  maxSec: number,
  jitterPct = 20,
  seed = 1
): number {
  const lo = Math.max(0, Math.min(minSec, maxSec)) * 1000
  const hi = Math.max(minSec, maxSec) * 1000
  const base = hi === lo ? lo : lo + lcg(seed * 7919 + index * 104729) * (hi - lo)
  const p = Math.max(0, jitterPct) / 100
  const jitter = base * p * (lcg(seed * 15485863 + index * 32452843) * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}
