// src/main/services/msgBridge/sendRegistry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SendRegistry } from './sendRegistry.ts'

test('settle 命中未决表；未知 localId 返回 false', async () => {
  const reg = new SendRegistry(1_000)
  const p = reg.add('L1', 'acc-x')
  assert.equal(reg.settle({ localId: 'L1', ok: true, msgKey: '真-1' }), true)
  assert.deepEqual(await p, { localId: 'L1', ok: true, msgKey: '真-1' })
  assert.equal(reg.settle({ localId: 'L9', ok: true }), false)
  assert.equal(reg.size, 0)
})

test('超时先落地，迟到的成功回执不再改口', async () => {
  const reg = new SendRegistry(5)
  const p = reg.add('L1', 'acc-x')
  assert.equal((await p).error, 'TIMEOUT')
  // 区分性证据：没有"表里已删除"这一步，迟到的 ok 会把已经报超时的气泡翻成功。
  assert.equal(reg.settle({ localId: 'L1', ok: true, msgKey: '真-1' }), false)
  assert.deepEqual(await p, { localId: 'L1', ok: false, error: 'TIMEOUT', detail: '>5ms' })
})

test('重复登记同一 localId：上一条以 SEND_FAILED 结掉，不永久挂起', async () => {
  const reg = new SendRegistry(1_000)
  const first = reg.add('L1', 'acc-x')
  const second = reg.add('L1', 'acc-x')
  assert.equal((await first).ok, false)
  assert.equal((await first).error, 'SEND_FAILED')
  reg.settle({ localId: 'L1', ok: true, msgKey: '真-2' })
  assert.equal((await second).msgKey, '真-2')
})

test('failView 只结掉该视图的未决', async () => {
  const reg = new SendRegistry(1_000)
  const a = reg.add('L1', 'acc-x')
  const b = reg.add('L2', 'acc-y')
  assert.equal(reg.failView('acc-x', 'BRIDGE_OFFLINE'), 1)
  assert.equal((await a).error, 'BRIDGE_OFFLINE')
  reg.settle({ localId: 'L2', ok: true, msgKey: '真-3' })
  assert.equal((await b).ok, true)
})
