// src/shared/groupOps.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalGate, joinGate, joinIntervalMs, kickTargetDecision, parseInviteCodes } from './groupOps.ts'

// ===== 人工门 =====

test('joinGate：只有 confirmed 能跑', () => {
  assert.equal(joinGate('confirmed'), true)
  assert.equal(joinGate('pending'), false)
  assert.equal(joinGate('running'), false)
  assert.equal(joinGate(null), false)
})

test('approvalGate：只有 approved 能跑，rejected/pending 都拒', () => {
  assert.equal(approvalGate('approved'), true)
  assert.equal(approvalGate('pending'), false)
  assert.equal(approvalGate('rejected'), false)
  assert.equal(approvalGate(undefined), false)
})

// ===== 踢人决策 =====

test('kickTargetDecision：canRemove 严格 true 才踢', () => {
  assert.equal(kickTargetDecision(true), 'kick')
  assert.equal(kickTargetDecision(false), 'skip', '不可踢→跳过，不硬踢')
  assert.equal(kickTargetDecision(null), 'skip', '未校验 ≠ 允许')
  assert.equal(kickTargetDecision(undefined), 'skip')
})

// ===== 随机间隔 =====

test('joinIntervalMs：落在 [min,max] 区间内', () => {
  for (let i = 0; i < 50; i++) {
    const v = joinIntervalMs(i, 60, 120, 0, 7)
    assert.ok(v >= 60000 && v <= 120000, `i=${i} 越界: ${v}`)
  }
})

test('joinIntervalMs：jitter 扩宽范围但不发散', () => {
  const noJitter = [0, 1, 2, 3, 4].map((i) => joinIntervalMs(i, 60, 60, 0, 1))
  for (const v of noJitter) assert.equal(v, 60000, 'min==max 且无抖动 → 恒定')

  let varied = 0
  for (let i = 0; i < 30; i++) if (joinIntervalMs(i, 60, 60, 20, 1) !== 60000) varied++
  assert.ok(varied > 0, '有抖动时不该全等')

  for (let i = 0; i < 50; i++) {
    const v = joinIntervalMs(i, 60, 60, 20, 1)
    assert.ok(v >= 48000 && v <= 72000, `±20% 抖动越界: ${v}`)
  }
})

test('joinIntervalMs：同 seed 同 i 可复现，不同 seed 未必同', () => {
  const a = [0, 1, 2].map((i) => joinIntervalMs(i, 60, 120, 20, 42))
  const b = [0, 1, 2].map((i) => joinIntervalMs(i, 60, 120, 20, 42))
  assert.deepEqual(a, b, '同 seed 必须可复现')
  const c = [0, 1, 2].map((i) => joinIntervalMs(i, 60, 120, 20, 43))
  assert.notDeepEqual(a, c, '不同 seed 应产生不同序列')
})

test('joinIntervalMs：min>max 也安全（内部会对调）', () => {
  const v = joinIntervalMs(0, 120, 60, 0, 1)
  assert.ok(v >= 60000 && v <= 120000, `应落在对调后的区间: ${v}`)
})

// ===== 邀请码解析 =====

test('parseInviteCodes：多行/逗号/空白分隔，去空去重', () => {
  const got = parseInviteCodes('abc\ndef\n\nabc, ghi ;  ')
  assert.deepEqual(got, ['abc', 'def', 'ghi'])
})

test('parseInviteCodes：空输入返回空数组', () => {
  assert.deepEqual(parseInviteCodes(''), [])
  assert.deepEqual(parseInviteCodes(null), [])
  assert.deepEqual(parseInviteCodes('   \n  '), [])
})
