// src/main/services/batchSend/sensitiveGate.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SENSITIVE_ERROR_CODE, withSensitiveGate } from './sensitiveGate.ts'
import type { Dispatch } from './engine.ts'
import type { BatchDetail } from '../../../shared/batchSend.ts'

const detail = (body: string | null): BatchDetail =>
  ({ id: 1, body } as unknown as BatchDetail)

/** 记录有没有被真发过，好证明"命中就不发"。 */
const spySend = (): { calls: string[]; send: Dispatch } => {
  const calls: string[] = []
  const send: Dispatch = async (d) => {
    calls.push(d.body ?? '')
    return { ok: true, msgKey: 'sent' }
  }
  return { calls, send }
}

test('命中敏感词：不调 sendText，按 failed 记 SENSITIVE_WORD', async () => {
  const { calls, send } = spySend()
  const gate = withSensitiveGate(async () => ['spam'], send)
  const out = await gate(detail('这是 spam'), 'v1', 'l1')
  assert.equal(out.ok, false)
  assert.equal(out.error, SENSITIVE_ERROR_CODE)
  assert.match(String(out.detail), /spam/)
  assert.equal(calls.length, 0, '命中时不该发出')
})

test('未命中([])：照发', async () => {
  const { calls, send } = spySend()
  const gate = withSensitiveGate(async () => [], send)
  const out = await gate(detail('你好'), 'v1', 'l1')
  assert.equal(out.ok, true)
  assert.equal(calls.length, 1)
})

test('判定这一跳没成(null)：fail-open 照发，不因风控抖动停整批', async () => {
  const { calls, send } = spySend()
  const gate = withSensitiveGate(async () => null, send)
  const out = await gate(detail('你好'), 'v1', 'l1')
  assert.equal(out.ok, true)
  assert.equal(calls.length, 1)
})

test('明细没有正文：跳过判定直接发', async () => {
  const { calls, send } = spySend()
  let checked = 0
  const gate = withSensitiveGate(async () => { checked++; return ['x'] }, send)
  const out = await gate(detail(null), 'v1', 'l1')
  assert.equal(out.ok, true)
  assert.equal(checked, 0, '无正文不该白跑一次判定')
  assert.equal(calls.length, 1)
})
