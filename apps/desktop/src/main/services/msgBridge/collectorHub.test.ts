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
function recorder(failFirst = 0): {
  calls: BatchPayload[]
  flush: (payload: BatchPayload) => Promise<BatchResult>
} {
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

/** 抓 console.warn：闸门里不许引第三方 spy，直接换掉再换回来。 */
function captureWarnings(run: () => Promise<void>): Promise<string[]> {
  return (async () => {
    const lines: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
    try {
      await run()
    } finally {
      console.warn = orig
    }
    return lines
  })()
}

/**
 * 后端逐行拒绝（`rejected` > 0）不走"退回重试"那条路，所以它没有别的痕迹。
 * 这两条用例钉的就是"静默丢行"这件事本身：Task 12 行 7 实测里，坏 chatKey 那条回执是 ok，
 * 页内也确实建成了会话，而库里 0 行——如果这里不打一行，链路上看不出任何异常。
 */
test('rejected>0：投出去成功也要留一行原因，且把 msgKey 前缀去掉只留固定文案', async () => {
  const flush = async (payload: BatchPayload): Promise<BatchResult> => ({
    accepted: payload.messages.length - 1,
    duplicated: 0,
    rejected: 1,
    reasons: ['true_0@c.us_K-1_out: chat_key 与平台不匹配']
  })
  const hub = new CollectorHub({ flush, batchSize: 2, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '1'))
  hub.push(frame(1, 'a@c.us', '2'))
  const lines = await captureWarnings(() => hub.flush())
  const hit = lines.filter((l) => l.includes('[msgHub] 本批拒绝'))
  assert.equal(hit.length, 1)
  assert.match(hit[0], /1\/2 条/)
  assert.equal(hit[0].includes('chat_key 与平台不匹配'), true)
  // 页面侧来的 msgKey 不进日志：只留后端那句固定文案。
  assert.equal(hit[0].includes('K-1'), false)
  hub.dispose()
})

test('全收时一行都不打；原因里的换行不能伪造日志行', async () => {
  const clean = async (payload: BatchPayload): Promise<BatchResult> => ({
    accepted: payload.messages.length,
    duplicated: 0,
    rejected: 0,
    reasons: []
  })
  const quietHub = new CollectorHub({ flush: clean, batchSize: 1, flushIntervalMs: 60_000 })
  quietHub.push(frame(1, 'a@c.us', '1'))
  const quiet = await captureWarnings(() => quietHub.flush())
  assert.deepEqual(quiet.filter((l) => l.includes('[msgHub]')), [])
  quietHub.dispose()

  const dirty = async (): Promise<BatchResult> => ({
    accepted: 0,
    duplicated: 0,
    rejected: 1,
    reasons: ['K-2\n[msgHub] 假装系统正常']
  })
  const hub = new CollectorHub({ flush: dirty, batchSize: 1, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '2'))
  const lines = await captureWarnings(() => hub.flush())
  const hit = lines.filter((l) => l.includes('[msgHub] 本批拒绝'))
  assert.equal(hit.length, 1)
  assert.equal(hit[0].includes('\n'), false)
  hub.dispose()
})
