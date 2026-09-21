// src/bridge/host.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMAND_CHANNEL, REPORT_CHANNEL, makeThrottledReporter, report, setSink } from './host.ts'
import type { BridgeReport } from '../shared/chatTypes.ts'

const message = (id: string): BridgeReport => ({
  kind: 'message',
  message: {
    chatKey: '861380000@c.us', msgKey: id, direction: 'in', mediaType: 'text',
    msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live', body: id
  }
})

/** 换一个收集器接住上行帧；每个用例自己决定要不要 setSink(null) 还原。 */
function collect(): { out: { channel: string; data: unknown }[] } {
  const out: { channel: string; data: unknown }[] = []
  setSink((channel, data) => void out.push({ channel, data }))
  return { out }
}

test('通道名固定：Task 10 的白名单与这里必须是同一字面值', () => {
  assert.equal(REPORT_CHANNEL, 'msg-report')
  assert.equal(COMMAND_CHANNEL, 'msg-cmd')
})

test('backfill_progress 在窗口内合帧，留的是最后一条', async () => {
  const { out } = collect()
  const push = makeThrottledReporter(10)
  push({ kind: 'backfill_progress', chatsDone: 1, chatsTotal: 3, messages: 5 })
  push({ kind: 'backfill_progress', chatsDone: 2, chatsTotal: 3, messages: 9 })
  push({ kind: 'backfill_progress', chatsDone: 3, chatsTotal: 3, messages: 14 })
  // 0 是区分性证据：没合帧时这里是 3。
  assert.equal(out.length, 0)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(out.length, 1)
  assert.equal((out[0].data as { chatsDone: number }).chatsDone, 3)
  assert.equal(out[0].channel, REPORT_CHANNEL)
  setSink(null)
})

test('cancel 后缓冲里的进度帧不再补发：destroy 之后不该还有帧出 IPC', async () => {
  const { out } = collect()
  const push = makeThrottledReporter(10)
  push({ kind: 'backfill_progress', chatsDone: 1, chatsTotal: 3, messages: 5 })
  push.cancel()
  await new Promise((r) => setTimeout(r, 40))
  // 不 cancel 时这里是 1（上一个用例证的），所以 0 才说明"撤掉的是真在途的那一帧"。
  assert.equal(out.length, 0)
  setSink(null)
})

test('message / send_result 每条直达，不进合帧窗口', () => {
  const { out } = collect()
  const push = makeThrottledReporter(1000)
  push(message('a'))
  push(message('b'))
  push({ kind: 'send_result', localId: 'L1', ok: true, msgKey: '真-1' })
  assert.equal(out.length, 3)
  setSink(null)
})

test('没有 sink 也没有 window.ele 时静默丢弃，不抛', () => {
  setSink(null)
  assert.doesNotThrow(() => report(message('x')))
})
