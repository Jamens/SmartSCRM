// src/shared/nurturePlan.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atMinutes, packAccounts, planSchedule, speakIntervalMs, speakingOrder, type PackAccount } from './nurturePlan.ts'

const acc = (...pairs: Array<[number, string]>): PackAccount[] => pairs.map(([id, platform]) => ({ id, platform }))

// ===== 装箱 =====

test('packAccounts 跨平台分箱（群 chatKey 属于某平台，跨平台不能同群）', () => {
  // 平台按**字典序**排（telegram < whatsapp），所以 telegram 箱在前
  const got = packAccounts(acc([1, 'whatsapp'], [2, 'whatsapp'], [3, 'telegram']), 10)
  assert.equal(got.length, 2, '两平台 → 两箱')
  assert.deepEqual(got[0].accountIds, [3], 'telegram 箱')
  assert.deepEqual(got[1].accountIds, [1, 2], 'whatsapp 箱')
})

test('packAccounts 装满 perGroup 开新箱，尾箱也成群（不丢账号）', () => {
  const got = packAccounts(acc([1, 'wa'], [2, 'wa'], [3, 'wa'], [4, 'wa'], [5, 'wa']), 2)
  assert.deepEqual(got.map((g) => g.accountIds), [[1, 2], [3, 4], [5]], '尾箱只有 1 个也要成群')
  assert.deepEqual(got.map((g) => g.groupIndex), [0, 1, 2])
})

test('packAccounts 稳定排序：传入顺序不同结果相同（可复现前提）', () => {
  const a = packAccounts(acc([3, 'wa'], [1, 'wa'], [2, 'wa']), 2)
  const b = packAccounts(acc([1, 'wa'], [3, 'wa'], [2, 'wa']), 2)
  assert.deepEqual(a, b, '同一批账号两次装箱必须一致，不能依赖传入顺序')
})

test('packAccounts 过滤脏数据、perGroup<=0 兜底为 1', () => {
  const got = packAccounts(
    [{ id: 1, platform: 'wa' }, { id: 2, platform: '' } as never, { id: 3, platform: 'wa', }].concat(
      [{ id: NaN, platform: 'wa' } as never]
    ),
    0
  )
  assert.deepEqual(got[0].accountIds, [1], 'platform 空与 id=NaN 都滤掉；id=0 是合法 id，不该被滤')
  assert.equal(packAccounts(acc([0, 'wa'], [1, 'wa']), 0).length, 2, 'perGroup=0 兜底成 1 → 两箱')
  assert.deepEqual(packAccounts(acc([0, 'wa'], [1, 'wa']), 10)[0].accountIds, [0, 1], 'id=0 要保留')
})

// ===== 日程 =====

test('planSchedule 时间点 × 轮次，按时间升序展开', () => {
  const got = planSchedule(['20:00', '09:30'], 2)
  assert.deepEqual(got, [
    { at: '09:30', round: 0 },
    { at: '09:30', round: 1 },
    { at: '20:00', round: 0 },
    { at: '20:00', round: 1 }
  ], '乱序输入应被排成时间升序')
})

test('planSchedule 非法时间点跳过、rounds 0 → 空', () => {
  assert.equal(planSchedule(['bad', '25:00', '10:00'], 1).length, 1, '非法 HH:mm 跳过不抛')
  assert.equal(planSchedule(['10:00'], 0).length, 0)
  assert.equal(planSchedule([], 3).length, 0)
})

test('atMinutes 解析与边界', () => {
  assert.equal(atMinutes('00:00'), 0)
  assert.equal(atMinutes('09:30'), 570)
  assert.equal(atMinutes('23:59'), 1439)
  assert.equal(atMinutes('24:00'), -1)
  assert.equal(atMinutes('x'), -1)
})

// ===== 发言顺序（可复现洗牌） =====

test('speakingOrder 同 seed 可复现、不同 seed 多半不同', () => {
  const ids = [1, 2, 3, 4, 5]
  const a = speakingOrder(ids, 42)
  const b = speakingOrder(ids, 42)
  assert.deepEqual(a, b, '同 seed 必须同顺序')
  assert.notDeepEqual(a, speakingOrder(ids, 43))
  assert.deepEqual([...ids].sort(), [...a].sort(), '必须是同一批账号的排列（不增不减）')
})

test('speakingOrder 不修改入参', () => {
  const ids = [3, 1, 2]
  const snapshot = [...ids]
  speakingOrder(ids, 7)
  assert.deepEqual(ids, snapshot)
})

test('speakingOrder 不同 groupIndex 顺序不同（同账号不同群不撞顺序）', () => {
  const ids = [1, 2, 3, 4]
  assert.notDeepEqual(speakingOrder(ids, 5, 0), speakingOrder(ids, 5, 1))
})

// ===== 发言间隔（可复现） =====

test('speakIntervalMs 落在区间内且同 seed 可复现', () => {
  for (let i = 0; i < 30; i++) {
    const v = speakIntervalMs(i, 60, 120, 20, 9)
    assert.ok(v >= 48000 && v <= 144000, '±20% 抖动越界: ' + v)
  }
  assert.equal(speakIntervalMs(0, 60, 120, 20, 9), speakIntervalMs(0, 60, 120, 20, 9))
})

test('speakIntervalMs min>max 也安全', () => {
  const v = speakIntervalMs(0, 120, 60, 0, 1)
  assert.ok(v >= 60000 && v <= 120000)
})
