// src/fingerprint/core/mix32.ts
/**
 * 无状态混合：由 `(seed, i)` 直接算出第 i 个位置的伪随机位。
 *
 * 与 `mulberry32` 的分工：mulberry32 是**有状态序列**（装一次钩取一次，用于"这个视图该长什么样"）；
 * mix32 是**无状态查表**（同一对入参永远同一个结果，用于"每次读都得给出同一个噪声"）。
 * 噪声若走有状态序列，`toDataURL` 连调两次就会给出两张不同的图——那本身就成了更响的指纹（R3）。
 */
export function mix32(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return h >>> 0
}
