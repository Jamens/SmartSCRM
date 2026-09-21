// src/main/services/msgBridge/msgApi.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMsgApi, isSendable } from './msgApi.ts'
import type { NormalizedMessage } from '../../../shared/chatTypes.ts'

const msg = (id: string): NormalizedMessage => ({
  chatKey: '861380000@c.us', msgKey: id, direction: 'in', mediaType: 'text', body: id,
  msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live'
})

interface Call { url: string; init: RequestInit }

function fakeFetch(response: { ok?: boolean; body: unknown }): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok: response.ok ?? true,
      async json(): Promise<unknown> {
        return response.body
      }
    }
  }) as unknown as typeof fetch
  return { calls, impl }
}

test('带 Bearer，且 body 就是 MessageBatchDTO 的形状', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { accepted: 1, duplicated: 0, rejected: 0, reasons: [] } } })
  const api = createMsgApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180/' })
  const out = await api.postBatch({ accountId: 7, activeChatKey: 'c1', messages: [msg('a')] })
  assert.equal(out?.accepted, 1)
  assert.equal(calls[0].url, 'http://h:8180/api/messages/batch')
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer T')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    accountId: 7, activeChatKey: 'c1', messages: [msg('a')]
  })
})

test('postStatuses 的 body 是 MessageStatusDTO 的形状：updates 是数组，不是平铺的 msgKey/status', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { updated: 3 } } })
  const api = createMsgApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180' })
  const out = await api.postStatuses({
    accountId: 7,
    chatKey: '861380000@c.us',
    updates: [
      { msgKey: 'm1', status: 'read' },
      { msgKey: 'm2', status: 'read' },
      { msgKey: 'm3', status: 'read' }
    ]
  })
  assert.equal(out?.updated, 3)
  assert.equal(calls.length, 1, '一批一请求：一 id 一请求在整群读回执那一帧就是几十个带行锁的事务')
  assert.equal(calls[0].url, 'http://h:8180/api/messages/status')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    accountId: 7,
    chatKey: '861380000@c.us',
    updates: [
      { msgKey: 'm1', status: 'read' },
      { msgKey: 'm2', status: 'read' },
      { msgKey: 'm3', status: 'read' }
    ]
  })
})

test('超过后端 updates 上限的批次按 200 切开，空批不发', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { updated: 200 } } })
  const api = createMsgApi({ token: () => 'T', fetchImpl: impl })
  const updates = Array.from({ length: 401 }, (_, i) => ({ msgKey: `m${i}`, status: 'read' as const }))
  assert.ok(await api.postStatuses({ accountId: 7, chatKey: 'c@g.us', updates }), '三批都成时才给结果')
  assert.deepEqual(
    calls.map((c) => (JSON.parse(String(c.init.body)) as { updates: unknown[] }).updates.length),
    [200, 200, 1],
    '不切批就是一发必然 400 的请求，而 400 在 call() 里被折成 null：整批状态静默不生效'
  )
  assert.equal((await api.postStatuses({ accountId: 7, chatKey: 'c@g.us', updates: [] }))?.updated, 0)
  assert.equal(calls.length, 3, 'updates 上是 @NotEmpty：空批不该出网')
})

test('未登录不发请求；后端 code!=0 也算失败（返回 null 让队列退避）', async () => {
  const noToken = fakeFetch({ body: { code: 0, data: {} } })
  assert.equal(await createMsgApi({ token: () => null, fetchImpl: noToken.impl }).postBatch({ accountId: 1, activeChatKey: null, messages: [msg('a')] }), null)
  assert.equal(noToken.calls.length, 0)

  const biz = fakeFetch({ body: { code: 40300, message: 'forbidden' } })
  assert.equal(await createMsgApi({ token: () => 'T', fetchImpl: biz.impl }).postStatuses({ accountId: 1, chatKey: 'c', updates: [{ msgKey: 'm', status: 'read' }] }), null)
})

test('listAccounts 在非 2xx / 结构不对时给空数组而不是抛', async () => {
  const down = fakeFetch({ ok: false, body: null })
  assert.deepEqual(await createMsgApi({ token: () => 'T', fetchImpl: down.impl }).listAccounts(), [])
})

test('空文本与超长文本不发出去', () => {
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: '   ', localId: 'L' }), false)
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: 'x'.repeat(5_001), localId: 'L' }), false)
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: '你好', localId: 'L' }), true)
})
