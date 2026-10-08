// src/renderer/src/lib/accountImpact.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { IMPACT_ROW_KEYS, hasArchivedRows, impactRowsOf } from './accountImpact.ts'
import type { AccountImpact } from '@/stores/accounts'

const sample = (over: Partial<AccountImpact> = {}): AccountImpact => ({
  conversations: 12,
  messages: 340,
  groups: 5,
  memberStates: 210,
  memberEvents: 88,
  ...over
})

test('五张连带表都在，顺序固定', () => {
  assert.deepEqual(IMPACT_ROW_KEYS, [
    'conversations',
    'messages',
    'groups',
    'memberStates',
    'memberEvents'
  ])
})

test('一条不落地列出五张表的计数', () => {
  const rows = impactRowsOf(sample())
  assert.equal(rows.length, 5)
  assert.deepEqual(
    rows.map((r) => [r.key, r.count]),
    [
      ['conversations', 12],
      ['messages', 340],
      ['groups', 5],
      ['memberStates', 210],
      ['memberEvents', 88]
    ]
  )
})

test('计数为 0 的那行留在名单里，不是消失', () => {
  // 0 说的是「这张表没被连带」，本身是有用的信息；滤掉它会让「只有消息、没有群」
  // 与「群档案根本没统计」长成同一句话。
  const rows = impactRowsOf(sample({ groups: 0, memberStates: 0, memberEvents: 0 }))
  assert.equal(rows.length, 5)
  assert.deepEqual(
    rows.filter((r) => r.count === 0).map((r) => r.key),
    ['groups', 'memberStates', 'memberEvents']
  )
})

test('没统计到时不编出五个 0', () => {
  assert.deepEqual(impactRowsOf(null), [])
})

test('全 0 才算不会连带任何记录', () => {
  assert.equal(hasArchivedRows(sample({ conversations: 0, messages: 0, groups: 0, memberStates: 0, memberEvents: 0 })), false)
  assert.equal(hasArchivedRows(sample({ conversations: 0, messages: 0, groups: 0, memberStates: 0, memberEvents: 1 })), true)
})
