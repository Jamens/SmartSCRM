/**
 * B18/B19 群操作的纯规则（配 node --test）。
 *
 * 全部**无 I/O、可复现**：随机间隔用「种子 + 线性同余」而不是 Math.random()，这样同 seed
 * 必得同序列——执行链断点续跑/重放时不会因为随机数不同而走出不同节奏（也就便于单测）。
 */

/** 线性同余伪随机（与具体 seed 绑定 → 可复现）。取模前用 Math.imul 防 32 位溢出丢精度。 */
function lcg(seed: number): number {
  const s = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return s / 0x100000000
}

/**
 * 随机间隔（毫秒）：在 [minSec, maxSec] 间取随机，再叠加 ±jitterPct% 抖动。
 *
 * 为什么要 jitter：固定间隔本身是风控指纹——真人手动加群不会精确每 60s 一次。
 * 抖动让"间隔"这个维度也随机，节奏才像人。
 *
 * @param i     第几个（0 起），同 i 同 seed 必得同值 → 可复现
 * @param jitterPct 抖动百分比，0 表示不抖
 */
export function joinIntervalMs(i: number, minSec: number, maxSec: number, jitterPct = 20, seed = 1): number {
  const lo = Math.max(0, Math.min(minSec, maxSec)) * 1000
  const hi = Math.max(minSec, maxSec) * 1000
  const base = hi === lo ? lo : lo + lcg(seed * 7919 + i * 104729) * (hi - lo)
  const p = Math.max(0, jitterPct) / 100
  const jitter = base * p * (lcg(seed * 15485863 + i * 32452843) * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}

/** 加群任务的人工门：只有 confirmed 能进执行链。 */
export function joinGate(status: string | null | undefined): boolean {
  return status === 'confirmed'
}

/** 踢人任务的人工门：只有 approved 能进执行链（pending/rejected 一律拒绝）。 */
export function approvalGate(approvalStatus: string | null | undefined): boolean {
  return approvalStatus === 'approved'
}

/**
 * 单条待踢项该不该真踢：`canRemove === false` → 不踢（标 skipped）。
 * 防止踢到超管/自己这类**不可逆**事故——即使人工确认过，能力不允许的也不硬来。
 * `canRemove == null`（还没校验）也返回 false：未校验 ≠ 允许。
 */
export function kickTargetDecision(canRemove: boolean | null | undefined): 'kick' | 'skip' {
  return canRemove === true ? 'kick' : 'skip'
}

/** 解析邀请码导入文本：每行一个，支持逗号/空白分隔；自动去空行、去重、去重行重复。 */
export function parseInviteCodes(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const line of String(raw).split(/[\r\n,;\s]+/)) {
    const c = line.trim()
    if (c) seen.add(c)
  }
  return [...seen]
}
