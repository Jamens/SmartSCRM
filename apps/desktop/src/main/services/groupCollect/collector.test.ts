// src/main/services/groupCollect/collector.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventCollectorHub, type EventBatchPayload } from './collector.ts'
import { GROUP_BODY_MAX, type GroupEventWire } from '../../../shared/groupMembers.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const event = (chatKey: string, memberKey: string): GroupEventWire => ({
  chatKey,
  memberKey,
  eventType: 'added',
  occurredAtEpochSec: 1_700_000_000,
  dedupKey: `${memberKey}|1700000000|added`,
  source: 'live_event'
})

function recorder(failFirst = 0): { calls: EventBatchPayload[]; flush: (p: EventBatchPayload) => Promise<void> } {
  const calls: EventBatchPayload[] = []
  let n = 0
  return {
    calls,
    flush: async (p) => {
      calls.push(p)
      if (n++ < failFirst) throw new Error('ECONNREFUSED')
    }
  }
}

test('攒够 batchSize 才冲；一批跨账号要拆开投（POST /batch 只有一个 accountId）', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 3, flushIntervalMs: 60_000 })
  hub.push(1, [event('a@g.us', '1@c.us')])
  hub.push(2, [event('b@g.us', '2@c.us')])
  // 区分性证据：如果是「来一条投一条」，这里 calls.length 已经是 2
  assert.equal(r.calls.length, 0)
  hub.push(1, [event('a@g.us', '3@c.us'), event('a@g.us', '4@c.us')])
  await wait(10)
  assert.deepEqual(
    r.calls.map((c) => [c.accountId, c.events.length]),
    [
      [1, 3],
      [2, 1]
    ]
  )
  assert.equal(hub.size, 0)
  hub.dispose()
})

test('没攒够也按点到冲（2s 语义，测试里 5ms）', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 5 })
  hub.push(1, [event('a@g.us', '1@c.us')])
  assert.equal(r.calls.length, 0)
  await wait(50)
  assert.equal(r.calls.length, 1)
  hub.dispose()
})

test('投不出去不丢数据：reject 的那一组退回队首，续上下一次触发', async () => {
  const calls: EventBatchPayload[] = []
  let down = true
  const hub = new EventCollectorHub({
    flush: async (p) => {
      calls.push(p)
      if (down) throw new Error('后端没起来')
    },
    batchSize: 2,
    flushIntervalMs: 60_000,
    retries: 2
  })
  hub.push(1, [event('a@g.us', '1@c.us')])
  await hub.flush()
  assert.equal(calls.length, 2, 'retries=2：这一次投递内部自己试了两回')
  assert.equal(hub.size, 1, '两回都失败：这一条必须还在队里，不许当没发生过')
  down = false
  await hub.flush()
  assert.equal(hub.size, 0)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].events[0].memberKey, '1@c.us')
  hub.dispose()
})

test('越界丢最旧并计数：事件丢了页内不会重发，这个数必须可查', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 1_000, maxQueue: 3, flushIntervalMs: 60_000 })
  hub.push(1, [event('a@g.us', '1@c.us'), event('a@g.us', '2@c.us')])
  hub.push(1, [event('a@g.us', '3@c.us'), event('a@g.us', '4@c.us'), event('a@g.us', '5@c.us')])
  assert.equal(hub.size, 3)
  assert.equal(hub.dropped, 2)
  await hub.flush()
  assert.deepEqual(r.calls[0].events.map((e) => e.memberKey), ['3@c.us', '4@c.us', '5@c.us'])
  hub.dispose()
})

test('非法条目进表前剔掉，push 返回收下的条数；bodySnapshot 超长截断而不是丢整条', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 60_000 })
  const longKey = 'x'.repeat(200)
  const taken = hub.push(1, [
    event('a@g.us', '1@c.us'),
    event('a@g.us', longKey),
    event(longKey, '2@c.us'),
    { ...event('a@g.us', '3@c.us'), memberKey: undefined as unknown as string },
    event('a@g.us', '4@c.us'),
    { ...event('a@g.us', '5@c.us'), bodySnapshot: 'y'.repeat(600) }
  ])
  assert.equal(taken, 3, '三条合法：1@c.us / 4@c.us / 5@c.us')
  await hub.flush()
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.calls[0].events.map((e) => e.memberKey), ['1@c.us', '4@c.us', '5@c.us'])
  assert.equal(r.calls[0].events[0].bodySnapshot, undefined, '没收 bodySnapshot 的不许被凭空造一个')
  assert.equal(r.calls[0].events[2].bodySnapshot?.length, GROUP_BODY_MAX)
  hub.dispose()
})

test('空数组不占队列也不起定时器；dispose 后 push 一律不收、flush 不投不抛', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 2, flushIntervalMs: 5 })
  assert.equal(hub.push(1, []), 0)
  await wait(30)
  assert.equal(r.calls.length, 0, '空批不该冲出一个 {accountId, events: []}')
  hub.dispose()
  assert.equal(hub.push(1, [event('a@g.us', '1@c.us')]), 0)
  await hub.flush()
  assert.equal(r.calls.length, 0)
})
