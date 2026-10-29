// src/fingerprint/core/seededRandom.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from './seededRandom.ts'

function take(seed: number, n: number): number[] {
  const r = mulberry32(seed)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r())
  return out
}

test('mulberry32 同 seed 两次序列完全相同：指纹在视图生命周期内必须稳定（R3）', () => {
  assert.deepEqual(take(20261028, 8), take(20261028, 8))
})

test('mulberry32 不同 seed 序列不同：换个档案就得换一张指纹', () => {
  const a = take(1, 8)
  const b = take(2, 8)
  assert.notDeepEqual(a, b)
  // 逐项都比一遍：只比第一项的话，"第二项起相同"这种半随机也能蒙混过关。
  for (let i = 0; i < a.length; i++) assert.notEqual(a[i], b[i])
})

test('mulberry32 落在 [0,1) 且不是常数', () => {
  const xs = take(7, 64)
  for (const x of xs) {
    assert.ok(x >= 0 && x < 1, `${x} 越界`)
  }
  assert.ok(new Set(xs).size > 60)
})
