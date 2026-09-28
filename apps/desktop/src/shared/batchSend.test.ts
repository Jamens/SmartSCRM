// src/shared/batchSend.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FAIL_STREAK_LIMIT, REPORT_BACKLOG_CAP, ReportBacklog, buildQueues,
  gapKindFor, outcomeStatus, pickIntervalSec
} from './batchSend.ts'
import type { BatchDetail, IntervalConfig } from './batchSend.ts'

const t: IntervalConfig = { msgMin: 3, msgMax: 8, chatMin: 5, chatMax: 15 }
const d = (id: number, seq: number, accountId: number, chatKey: string): BatchDetail => ({
  id, taskId: 1, seq, accountId, chatKey, contentIndex: 0, body: 'x',
  sendStatus: 'pending', recallStatus: 'none'
})

test('buildQueues: 每个账号一条队列，队列内按 seq 升序', () => {
  const rows = [d(5, 5, 2, 'b'), d(1, 1, 1, 'a'), d(3, 3, 1, 'a'), d(2, 2, 2, 'b')]
  const q = buildQueues(rows, [1, 2])
  assert.deepEqual(q.map((x) => x.map((r) => r.id)), [[1, 3], [2, 5]])
})

test('buildQueues: 没在 accountIds 里的行不进队列（账号被剔出任务不该照跑）', () => {
  // .flat()：实现保证「每个账号一条队列」（长度 = accountIds.length），账号下没有可发行时
  // 拿到的是 [[]] 而不是 []。这里要比的是「没有行进队列」，不是队列条数——条数由上一条钉住。
  assert.deepEqual(buildQueues([d(1, 1, 9, 'a')], [1]).flat(), [])
})

test('buildQueues: 终态行不进队列（重跑一个已 done 的任务不该重发成功条目）', () => {
  const done = { ...d(1, 1, 1, 'a'), sendStatus: 'success' as const }
  assert.deepEqual(buildQueues([done], [1]).flat(), [])
})

test('pickIntervalSec: 落在 [min,max] 且取整，边界两种随机数都夹得住', () => {
  assert.equal(pickIntervalSec('msg', t, () => 0), 3)
  assert.equal(pickIntervalSec('msg', t, () => 0.999999), 8)
  assert.equal(pickIntervalSec('chat', t, () => 0.5), 10)
  for (let i = 0; i < 200; i++) {
    const v = pickIntervalSec('msg', t, Math.random)
    assert.ok(v >= 3 && v <= 8 && Number.isInteger(v), `越界读数 ${v}`)
  }
})

test('pickIntervalSec: min===max 时不抖动', () =>
  assert.equal(pickIntervalSec('msg', { msgMin: 7, msgMax: 7, chatMin: 0, chatMax: 0 }, () => 0.3), 7))

test('outcomeStatus: TIMEOUT 是 unknown 而不是 failed', () => {
  assert.equal(outcomeStatus({ ok: true }), 'success')
  assert.equal(outcomeStatus({ ok: false, error: 'TIMEOUT' }), 'unknown')
  assert.equal(outcomeStatus({ ok: false, error: 'SEND_FAILED' }), 'failed')
  assert.equal(outcomeStatus({ ok: false }), 'failed')
})

test('ReportBacklog: 溢出丢最旧并计数，drain 保序且清空', () => {
  const b = new ReportBacklog<number>()
  for (let i = 0; i < REPORT_BACKLOG_CAP + 3; i++) b.push(i)
  assert.equal(b.size, REPORT_BACKLOG_CAP)
  assert.equal(b.dropped, 3)
  const out = b.drain()
  assert.equal(out.length, REPORT_BACKLOG_CAP)
  assert.equal(out[0], 3)
  assert.equal(b.size, 0)
  assert.deepEqual(b.drain(), [])
})

test('gapKindFor: 同人接续算 msg，换人算 chat；跨账号同 chatKey 必须算换人', () => {
  const first = d(1, 1, 1, '8613800001001@c.us')
  assert.equal(gapKindFor(null, first), 'chat')
  assert.equal(gapKindFor(first, d(2, 2, 1, '8613800001001@c.us')), 'msg')
  assert.equal(gapKindFor(first, d(3, 3, 2, '8613800001001@c.us')), 'chat')
})

test('FAIL_STREAK_LIMIT 就是 3（spec §5 的熔断阈值只有一个出处）', () =>
  assert.equal(FAIL_STREAK_LIMIT, 3))
