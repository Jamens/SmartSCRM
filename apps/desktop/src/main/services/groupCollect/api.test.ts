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

// ---------------------------------------------------------------------------
// staleGroups：建档泵的 sort=stale 读口（R28 / R41 的位置优先）
// ---------------------------------------------------------------------------

test('staleGroups GET /api/group-members/groups 带 sort=stale 与 size，映射成 {keys,total}', async () => {
  const { calls, impl } = fakeFetch({
    body: {
      code: 0,
      data: {
        records: [
          { chatKey: 'never@g.us', title: '甲' },
          { chatKey: 'old@g.us', title: '乙' }
        ],
        // total 刻意与 records 的条数**不等**：后端给的是筛选后的总行数，不是本页给回的条数。
        // 取同一个小就等于把"total 从哪来"这条断言写成恒真——泵拿 total 判"这一页是不是全集"，
        // 拿条数当总数会把截断页误判成全集，进而把没挤进页的群顶到最前。
        total: 937,
        page: 1,
        pageSize: 200
      }
    }
  })
  const api = createGroupCollectApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180/' })
  const out = await api.staleGroups(7, 200)
  assert.deepEqual(out, { keys: ['never@g.us', 'old@g.us'], total: 937 },
    '次序就是后端的次序，不许在客户端重排；total 取后端的筛选总数而非本页条数')
  assert.equal(calls[0].url, 'http://h:8180/api/group-members/groups?accountId=7&sort=stale&page=1&size=200')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.body, undefined, '读口不许带 body')
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer T')
})

test('staleGroups：非 2xx / 信封非 0 / 网络错 / 无 token 一律抛（泵会退化成保桥次序）', async () => {
  const { impl: notOk } = fakeFetch({ ok: false, body: { code: 0, data: { records: [], total: 0 } } })
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: notOk }).staleGroups(7, 200))

  const { impl: badCode } = fakeFetch({ body: { code: 40013, data: null } })
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: badCode }).staleGroups(7, 200))

  const throwing = (async () => {
    throw new Error('network')
  }) as unknown as typeof fetch
  await assert.rejects(() => createGroupCollectApi({ token: () => 'T', fetchImpl: throwing }).staleGroups(7, 200))

  const { calls, impl } = fakeFetch({ body: { code: 0, data: { records: [], total: 0 } } })
  await assert.rejects(() => createGroupCollectApi({ token: () => null, fetchImpl: impl }).staleGroups(7, 200))
  assert.equal(calls.length, 0, '没 token 时这一跳根本不该发出去')
})

test('staleGroups 剔掉没有可用 chatKey 的行；total 缺失时按给回的条数算', async () => {
  const { impl } = fakeFetch({
    body: {
      code: 0,
      data: { records: [{ chatKey: 'a@g.us' }, { chatKey: '' }, { title: '缺键' }, null], page: 1 }
    }
  })
  const out = await createGroupCollectApi({ token: () => 'T', fetchImpl: impl }).staleGroups(7, 200)
  assert.deepEqual(out.keys, ['a@g.us'], '空串与缺键的行会冒充"这一群已登记"，必须剔掉')
  assert.equal(out.total, 1, 'total 缺失时按条数算，泵会当成全集在手（宁可多补未建档的）')
})
