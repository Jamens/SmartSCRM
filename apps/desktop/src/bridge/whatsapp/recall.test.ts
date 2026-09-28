// src/bridge/whatsapp/recall.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recallViaWa } from './recall.ts'
import type { RecallCmd } from './recall.ts'

const cmd: RecallCmd = { kind: 'recall', localId: 'R1', chatKey: '8613800000000@c.us', msgKey: 'true_8613800000000@c.us_ABC_out' }

test('第四位必须是 revoke=true，且入参剥掉 _out 尾', async () => {
  const seen: unknown[][] = []
  const r = await recallViaWa(cmd, {
    deleteMessage: async (...args: unknown[]) => { seen.push(args); return { isRevoked: true } }
  })
  assert.deepEqual(seen[0], ['8613800000000@c.us', 'true_8613800000000@c.us_ABC', false, true])
  assert.deepEqual(r, { localId: 'R1', ok: true, isRevoked: true })
})

test('isRevoked 不为 true 就是失败：删除自己这边不算"对所有人撤回"', async () => {
  const r = await recallViaWa(cmd, { deleteMessage: async () => ({ isDeleted: true }) })
  assert.equal(r.ok, false)
  assert.equal(r.isRevoked, false)
  assert.match(r.detail ?? '', /isRevoked/)
})

test('没有 chat 对象 → BRIDGE_OFFLINE 形状（detail 说明是哪个能力不在）', async () => {
  const r = await recallViaWa(cmd, undefined)
  assert.equal(r.ok, false)
  assert.match(r.detail ?? '', /deleteMessage/)
})

test('页内抛错折成 detail 原文，不抛出到主进程', async () => {
  const r = await recallViaWa(cmd, {
    deleteMessage: async () => { throw new Error('message no longer than 21915 seconds') }
  })
  assert.equal(r.ok, false)
  assert.match(r.detail ?? '', /21915/)
})
