// src/main/services/msgBridge/sendRegistry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SendAttribution, SendRegistry } from './sendRegistry.ts'
import type { NormalizedMessage } from '../../../shared/chatTypes.ts'

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

const out = (msgKey: string, over: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  chatKey: '861380001001@c.us',
  msgKey,
  direction: 'out',
  body: 'hi',
  mediaType: 'text',
  msgTimeEpochSec: 1_700_000_000,
  status: 'pending',
  source: 'live',
  ...over
})

test('回执先到：settle 交回正文与 chatKey（主进程要自己补一行），随后事件流同 msgKey 盖成 app_send', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  assert.deepEqual(at.settle('L1', 'K-1'), { chatKey: '861380001001@c.us', text: 'hi' })
  const stamped = at.stamp('acc-1', out('K-1'))
  assert.equal(stamped.source, 'app_send')
  assert.equal(stamped.sendLocalId, 'L1')
})

test('事件流先到：按 viewId+chatKey+文本消化 intent，回执随后返回 null（不再补写第二行）', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  const stamped = at.stamp('acc-1', out('K-1'))
  assert.equal(stamped.source, 'app_send')
  assert.equal(stamped.sendLocalId, 'L1')
  assert.equal(at.settle('L1', 'K-1'), null)
})

test('同会话连发两条相同文本：FIFO 各自对应自己的 localId，不会都盖到第一条上', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  at.claim('acc-1', 'L2', '861380001001@c.us', 'hi')
  assert.equal(at.stamp('acc-1', out('K-1'))?.sendLocalId, 'L1')
  assert.equal(at.stamp('acc-1', out('K-2'))?.sendLocalId, 'L2')
})

test('不属于本应用的发出消息一律 native_send；收进行原样不动', () => {
  const at = new SendAttribution()
  assert.equal(at.stamp('acc-1', out('K-9')).source, 'native_send')
  const inRow: NormalizedMessage = { ...out('K-8'), direction: 'in', source: 'backfill' }
  assert.deepEqual(at.stamp('acc-1', inRow), inRow)
})

test('abandon 之后同文本的消息不再被认领；过期 intent 同样失效；dropView 只清该视图', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  at.abandon('L1')
  assert.equal(at.stamp('acc-1', out('K-1')).source, 'native_send')

  const clock = { t: 1_000 }
  const at2 = new SendAttribution({ maxAgeMs: 10, now: () => clock.t })
  at2.claim('acc-1', 'L2', '861380001001@c.us', 'hi')
  clock.t = 2_000
  assert.equal(at2.stamp('acc-1', out('K-2')).source, 'native_send')

  const at3 = new SendAttribution()
  at3.claim('acc-1', 'L1', 'c1', 'hi')
  at3.claim('acc-2', 'L2', 'c2', 'hi')
  assert.equal(at3.dropView('acc-1'), 1)
  assert.deepEqual(at3.pendingIntents(), ['L2'])
})

test('intent 过期但回执仍到：settle 的第三种落地照样交回原文（补写不因此断链）', () => {
  const clock = { t: 1_000 }
  const at = new SendAttribution({ maxAgeMs: 10, now: () => clock.t })
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  // 过期只在 stamp 入口被 sweep 看见（设计约束 ②），所以先让一条无关消息来问一次。
  clock.t = 2_000
  assert.equal(at.stamp('acc-1', out('K-0')).source, 'native_send')
  assert.equal(at.pendingIntents().length, 0)
  // 回执迟到不等于不知道发了什么：`expired` 那份短命副本就是为这一条留的。
  assert.deepEqual(at.settle('L1', 'K-1'), { chatKey: '861380001001@c.us', text: 'hi' })
})

/**
 * 认领条件的反向半证：`同会话连发` 那条只证了"同会话应当认领"，这里钉住"不同会话 / 不同视图
 * 不能认领"——少了这两个守卫，用户在 A 会话手打的同文本消息会被 B 会话那条未决 intent 认成
 * app_send，代价是把用户手发的算成本应用发的（比认漏更贵）。
 */
test('认领必须同视图同会话：换个 chatKey 或换个 viewId 的同文本消息不算本应用发的', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  assert.equal(at.stamp('acc-1', out('K-2', { chatKey: '861380009999@c.us' })).source, 'native_send')
  assert.equal(at.stamp('acc-2', out('K-3')).source, 'native_send')
  // 两次错认都不该消耗 intent：随后真正那条仍要被认领。
  const claimed = at.stamp('acc-1', out('K-4'))
  assert.equal(claimed.source, 'app_send')
  assert.equal(claimed.sendLocalId, 'L1')
  assert.deepEqual(at.pendingIntents(), [])
})
