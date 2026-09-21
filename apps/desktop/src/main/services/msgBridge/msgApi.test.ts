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

test('postStatus 的 body 是 MessageStatusDTO 的形状：updates 是数组，不是平铺的 msgKey/status', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { updated: 1 } } })
  const api = createMsgApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180' })
  const out = await api.postStatus({ accountId: 7, chatKey: '861380000@c.us', msgKey: 'm1', status: 'read' })
  assert.equal(out?.updated, 1)
  assert.equal(calls[0].url, 'http://h:8180/api/messages/status')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    accountId: 7,
    chatKey: '861380000@c.us',
    updates: [{ msgKey: 'm1', status: 'read' }]
  })
})

test('未登录不发请求；后端 code!=0 也算失败（返回 null 让队列退避）', async () => {
  const noToken = fakeFetch({ body: { code: 0, data: {} } })
  assert.equal(await createMsgApi({ token: () => null, fetchImpl: noToken.impl }).postBatch({ accountId: 1, activeChatKey: null, messages: [msg('a')] }), null)
  assert.equal(noToken.calls.length, 0)

  const biz = fakeFetch({ body: { code: 40300, message: 'forbidden' } })
  assert.equal(await createMsgApi({ token: () => 'T', fetchImpl: biz.impl }).postStatus({ accountId: 1, chatKey: 'c', msgKey: 'm', status: 'read' }), null)
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
