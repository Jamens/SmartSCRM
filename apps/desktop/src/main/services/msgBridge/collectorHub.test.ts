// src/main/services/msgBridge/collectorHub.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CollectorHub, type BatchPayload, type BatchResult } from './collectorHub.ts'
import type { LiveFrame, NormalizedMessage } from '../../../shared/chatTypes.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const msg = (chatKey: string, id: string): NormalizedMessage => ({
  chatKey, msgKey: id, direction: 'in', mediaType: 'text', body: id,
  msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live'
})

const frame = (accountId: number, chatKey: string, id: string): LiveFrame => ({
  viewId: `view-${accountId}`, accountId, platform: 'whatsapp', activeChatKey: chatKey, message: msg(chatKey, id)
})

/** 记录每次真正投出去的批次；`failFirst` 决定前几次 reject（模拟后端不可用）。 */
function recorder(failFirst = 0) {
  const calls: BatchPayload[] = []
  let n = 0
  const flush = async (payload: BatchPayload): Promise<BatchResult> => {
    calls.push(payload)
    if (n++ < failFirst) throw new Error('ECONNREFUSED')
    return { accepted: payload.messages.length, duplicated: 0, rejected: 0, reasons: [] }
  }
  return { calls, flush }
}

test('攒够 batchSize 才冲，一批跨会话要分组投', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 3, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '1'))
  hub.push(frame(1, 'b@c.us', '2'))
  // 区分性证据：如果实现是"来一条投一条"，这里 calls.length 已经是 2
  assert.equal(r.calls.length, 0)
  hub.push(frame(1, 'a@c.us', '3'))
  await wait(5)
  assert.deepEqual(
    r.calls.map((c) => [c.accountId, c.activeChatKey, c.messages.length]),
    [
      [1, 'a@c.us', 2],
      [1, 'b@c.us', 1]
    ]
  )
  assert.equal(hub.size(), 0)
  hub.dispose()
})

test('没攒够也按点到冲（2s 语义，这里 5ms）', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 5 })
  hub.push(frame(1, 'a@c.us', '1'))
  assert.equal(r.calls.length, 0)
  await wait(50)
  assert.equal(r.calls.length, 1)
  assert.equal(r.calls[0].messages.length, 1)
  hub.dispose()
})

test('队列越界丢最旧，丢了几个要可查', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 1_000, maxQueue: 3, flushIntervalMs: 60_000 })
  for (let i = 0; i < 5; i++) hub.push(frame(1, 'a@c.us', `${i}`))
  assert.equal(hub.size(), 3)
  assert.equal(hub.dropped, 2)
  await hub.flush()
  // 丢的必须是最旧的两条（0、1），留下的顺序不变
  assert.deepEqual(r.calls[0].messages.map((m) => m.msgKey), ['2', '3', '4'])
  hub.dispose()
})

test('投递失败：重试到上限后把没投出去的退回队首，恢复后按原顺序续投', async () => {
  let attempts = 0
  const calls: BatchPayload[] = []
  const flush = async (payload: BatchPayload): Promise<BatchResult> => {
    attempts++
    if (attempts <= 3) throw new Error('ECONNREFUSED')
    calls.push(payload)
    return { accepted: payload.messages.length, duplicated: 0, rejected: 0, reasons: [] }
  }
  const hub = new CollectorHub({ flush, batchSize: 2, maxQueue: 10, retries: 3, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '1'))
  hub.push(frame(1, 'a@c.us', '2'))
  await wait(5)
  assert.equal(attempts, 3)
  assert.equal(calls.length, 0)
  // 这一条是本任务的核心断言：投不出去时数据不蒸发（丢掉就等于采集永久缺口）
  assert.equal(hub.size(), 2)
  hub.push(frame(1, 'a@c.us', '3'))
  hub.push(frame(1, 'a@c.us', '4'))
  await hub.flush()
  assert.deepEqual(calls.flatMap((c) => c.messages.map((m) => m.msgKey)), ['1', '2', '3', '4'])
  assert.equal(hub.size(), 0)
  hub.dispose()
})
