// src/main/services/groupCollect/api.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGroupCollectApi } from './api.ts'

interface Call {
  url: string
  init: RequestInit
}

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

const payload = {
  accountId: 7,
  groups: [{ chatKey: 'g1@g.us', title: '群一' }],
  snapshot: {
    chatKey: 'g1@g.us',
    participants: [{ memberKey: '8613000000001@c.us', phone: null, displayName: null, roleType: 'member' as const }]
  }
}

test('ingest POST 到 /api/group-members/batch，带 Bearer，body 三段独立且空段传 null', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { reconciled: false, reason: 'coverage < 0.6' } } })
  const api = createGroupCollectApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180/' })
  // 只带 snapshot、不带 groups/events：后端应收到 null 而非 []
  const out = await api.ingest({ accountId: 7, snapshot: payload.snapshot })
  assert.equal(out.reconciled, false)
  assert.equal(out.reason, 'coverage < 0.6')
  assert.equal(calls[0].url, 'http://h:8180/api/group-members/batch')
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer T')
  const sent = JSON.parse(String(calls[0].init.body))
  assert.deepEqual(sent, {
    accountId: 7,
    groups: null,
    snapshot: payload.snapshot,
    events: null
  })
  assert.equal((sent as Record<string, unknown>).platform, undefined, 'platform 不从请求体取，后端按账号反查')
})

test('ingest 收到非 2xx / 信封非 0 / 网络错 都抛错（引擎会记 failed 并下一轮重试）', async () => {
  const { impl: notOk } = fakeFetch({ ok: false, body: { code: 0, data: {} } })
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: notOk }).ingest(payload))

  const { impl: badCode } = fakeFetch({ body: { code: 400, data: null } })
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: badCode }).ingest(payload))

  const throwing = (async () => {
    throw new Error('network')
  }) as unknown as typeof fetch
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: throwing }).ingest(payload))
})

test('token 为 null 时 ingest 直接抛（不发出必然 401 的请求）', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: {} } })
  await assert.rejects(() => createGroupCollectApi({ token: () => null, fetchImpl: impl }).ingest(payload))
  assert.equal(calls.length, 0)
})
