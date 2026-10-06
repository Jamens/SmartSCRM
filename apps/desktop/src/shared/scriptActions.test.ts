// src/shared/scriptActions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_TYPES, SCRIPT_ACTIONS, failoverAccount, isDelegatedAction, nextStep } from './scriptActions.ts'

test('动作词表：五类齐全、post_message 作用于群', () => {
  assert.ok(ACTION_TYPES.includes('post_message'))
  assert.ok(ACTION_TYPES.includes('dm_member'))
  assert.equal(SCRIPT_ACTIONS.post_message.onGroup, true)
  assert.equal(SCRIPT_ACTIONS.dm_member.onGroup, false)
})

test('nextStep：返回第一个 pending/null 的 seq', () => {
  assert.equal(nextStep(['success', 'pending', 'pending']), 1)
  assert.equal(nextStep([null, 'success']), 0)
  assert.equal(nextStep(['success', null]), 1)
})

test('nextStep：跳过 sending（正在跑不算待补）', () => {
  assert.equal(nextStep(['success', 'sending', 'pending']), 2)
  assert.equal(nextStep(['sending']), null, '只有 sending 时无待跑')
})

test('nextStep：failed 不自动重试、全成功返 null', () => {
  assert.equal(nextStep(['success', 'failed', 'pending']), 2, 'failed 不被当待补，跳过到下一个 pending')
  assert.equal(nextStep(['success', 'failed']), null, 'failed 不自动重试，也无 pending → 返 null 交人工')
  assert.equal(nextStep(['success', 'skipped']), null, '全成功/跳过=一轮跑完')
  assert.equal(nextStep([]), null)
})

test('failoverAccount：切下一个、用尽返 null', () => {
  assert.equal(failoverAccount([1, 2, 3], 0), 2)
  assert.equal(failoverAccount([1, 2, 3], 1), 3)
  assert.equal(failoverAccount([1, 2, 3], 2), null, '最后一个失败 → 用尽')
  assert.equal(failoverAccount([1], 0), null)
  assert.equal(failoverAccount([1, null, 3], 0), 3, '跳过空账号取下一个')
})

// ===== 委托类动作（B8 剧本对接 B18/B19） =====

test('isDelegatedAction：只有 join_group/kick_member 是委托类', () => {
  assert.equal(isDelegatedAction('join_group'), true)
  assert.equal(isDelegatedAction('kick_member'), true)
  assert.equal(isDelegatedAction('post_message'), false, '普通动作不当场执行')
  assert.equal(isDelegatedAction('dm_member'), false)
  assert.equal(isDelegatedAction('react'), false)
  assert.equal(isDelegatedAction(null), false)
})
