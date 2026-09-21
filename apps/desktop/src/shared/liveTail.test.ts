// src/shared/liveTail.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTail, pendingKey, settlePending, type TailRow } from './liveTail.ts'

const row = (msgKey: string, ts: number, extra: Record<string, unknown> = {}): TailRow & Record<string, unknown> => ({
  msgKey,
  ts,
  ...extra
})

test('mergeTail：同 msgKey 覆盖字段而不新增行（状态推进的落点）', () => {
  const before = [row('a', 10, { status: 'sent' })]
  const after = mergeTail(before, [row('a', 10, { status: 'delivered' })])
  assert.equal(after.length, 1)
  assert.equal(after[0].status, 'delivered')
  // ts 不同时取更大者（`ts: Math.max(...)` 的落点）：同键行仍不新增。
  assert.equal(mergeTail([row('a', 10)], [row('a', 20)])[0].ts, 20)
  // 反方向也要钉住：迟到的旧 ts 覆盖不得把行拉回去（纯 spread 会在这里露馅）
  assert.equal(mergeTail([row('a', 20)], [row('a', 10)])[0].ts, 20)
})

test('mergeTail：翻页窗口之外的旧尾巴丢弃，窗口之后的按时间插入', () => {
  const before = [row('b', 20), row('c', 30)]
  const after = mergeTail(before, [row('a', 10), row('d', 40), row('c2', 25)])
  // 'a' 比窗口里最早的一行还旧且不在库里 → 以库为准，丢弃。
  assert.deepEqual(after.map((r) => r.msgKey), ['b', 'c2', 'c', 'd'])
})

test('mergeTail：空入参与空 incoming 都不炸', () => {
  assert.deepEqual(mergeTail([], []), [])
  assert.deepEqual(mergeTail([], [row('x', 5)]).map((r) => r.msgKey), ['x'])
})

test('settlePending：乐观气泡原地换成真实 msgKey，位置不动、行数不增', () => {
  const before = [row(pendingKey('L1'), 100, { status: 'pending' }), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'sent' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  assert.equal(after[0].status, 'sent')
  assert.equal(after[1].msgKey, 'c')
})

test('settlePending：库行已经先到时不重复插气泡', () => {
  const before = [row('真-39', 100), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'read' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  // 找不到待空气泡但真实键已存在 → 就地把状态并进去，仍然不新增行。
  assert.equal(after[0].status, 'read')
})
