// src/fingerprint/core/seededRandom.ts
/**
 * mulberry32：32 位状态、整数乘法混合，序列由 seed 唯一决定。
 *
 * 指纹要的是「同一 seed 每次都是同一条序列，不同 seed 明显不是同一条」——
 * `Math.random()` 两头都做不到：每次刷新都变 = 每次都是一张新指纹，比不改更显眼（R3）。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
