// src/main/services/batchSend/batchApi.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBatchApi } from './batchApi.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('reports：信封 code=0 才认，返回 data', async () => {
  const calls: { path: string; body: string }[] = []
  const api = createBatchApi({
    fetcher: async (path, init) => {
      calls.push({ path, body: String(init.body) })
      return json({ code: 0, message: 'ok', data: { sentCount: 2, failCount: 1, totalCount: 4, status: 'running' } })
    }
  })
  const out = await api.reports(9, [{ detailId: 1, sendStatus: 'success' }], false)
  assert.equal(out?.status, 'running')
  assert.equal(calls[0].path, '/api/batch-send/tasks/9/reports')
  assert.ok(calls[0].body.includes('"allHalted":false'), calls[0].body)
})

test('任何非 0 信封 / 非 2xx / 抛错都塌成 null 或 0，不抛出到调用方', async () => {
  const boom = createBatchApi({ fetcher: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(await boom.heartbeat(1), 0)
  // Fix A：retryFailed 把「这一跳没成」与「没有 failed 行」分开——抛错是前者，塌 null 不再塌 0。
  assert.equal(await boom.retryFailed(1), null)
  assert.equal(await boom.recall(1, [1]), null)
  const bad = createBatchApi({ fetcher: async () => json({ code: 40902, message: '状态非法' }, 409) })
  assert.equal(await bad.start(1), null)
  assert.equal(await bad.heartbeat(1), 0)
})

test('401 无 data 字段这条既有口径不在这里兜：只信 code===0 && data!==undefined', async () => {
  const api = createBatchApi({ fetcher: async () => json({ code: 401, message: 'unauthorized' }, 401) })
  assert.equal(await api.task(1), null)
})

// A8 群发敏感词：三态必须分得开——[词]=命中拦、[]=未命中照发、null=这一跳没成→调用方 fail-open。
test('checkSensitive：命中回词、未命中回空数组、这一跳没成回 null', async () => {
  const hit = createBatchApi({ fetcher: async () => json({ code: 0, data: ['spam'] }) })
  assert.deepEqual(await hit.checkSensitive('这是 spam'), ['spam'])

  const clean = createBatchApi({ fetcher: async () => json({ code: 0, data: [] }) })
  assert.deepEqual(await clean.checkSensitive('你好'), [])

  const dead = createBatchApi({ fetcher: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(await dead.checkSensitive('x'), null)
  const httpFail = createBatchApi({ fetcher: async () => json({ code: 500, message: 'boom' }, 500) })
  assert.equal(await httpFail.checkSensitive('x'), null)
})

test('recall 出参保留 eligible 与 rejected 两侧', async () => {
  const api = createBatchApi({
    fetcher: async () => json({ code: 0, data: {
      eligible: [{ detailId: 3, accountId: 7, chatKey: 'a@c.us', msgKey: 'true_a@c.us_3_out' }],
      rejected: [{ detailId: 4, reason: '这一条不是成功状态（send_status=failed），撤回无从谈起' }]
    } })
  })
  const plan = await api.recall(1, [3, 4])
  assert.equal(plan?.eligible.length, 1)
  assert.match(plan?.rejected[0].reason ?? '', /不是成功状态/)
})

// R11：同一条端点两种粒度。省略或空数组 = 整批复位（不发 body），带 detailIds = 只复位勾选的那几条。
// 这一支是全文件最容易静默坏掉的地方：把空数组拼成 body 发出去，后端按整批复位还是按零条复位，
// 调用方在渲染层看不出来——单条重发按钮会「成功」但复位了整批。
test('retryFailed：省略/空数组都不带 body，非空数组只带那几条', async () => {
  const seen: { path: string; body?: string }[] = []
  const api = createBatchApi({
    fetcher: async (path, init) => {
      seen.push({ path, body: init.body === undefined ? undefined : String(init.body) })
      return json({ code: 0, data: { reset: 1, status: 'paused' } })
    }
  })
  assert.equal(await api.retryFailed(1), 1)
  assert.equal(await api.retryFailed(1, []), 1)
  assert.equal(seen[0].body, undefined)
  assert.equal(seen[1].body, undefined)
  await api.retryFailed(1, [7, 8])
  assert.equal(seen[2].body, JSON.stringify({ detailIds: [7, 8] }))
})

// Fix A：retryFailed 的 0 有两种读法——「后端拒了这一跳」和「这个任务确实没有 failed 行」。
// 塌成同一个 0，渲染层就分不开，详情页会在后端根本没接住时说「这几条不是失败状态，没有可重发的」，
// 一句关于用户数据的假话。这一跳从此与 postProgress 同口径：null = 这一跳没成 / 0 = 打到了没得重发 / N = 复位数。
test('retryFailed：null 是被拒/不可达/信封不对，0 是真没有 failed 行，N 是复位数', async () => {
  const ok = (reset: number): ReturnType<typeof createBatchApi> =>
    createBatchApi({ fetcher: async () => json({ code: 0, data: { reset } }) })
  assert.equal(await ok(0).retryFailed(1), 0, '打到后端、reset=0 = 真的没有 failed 行')
  assert.equal(await ok(3).retryFailed(1), 3, 'reset=3 = 复位了 3 条')
  assert.equal(
    await createBatchApi({ fetcher: async () => json({ code: 40902, message: '状态非法' }, 409) }).retryFailed(1),
    null,
    '非 2xx（后端拒绝）塌 null，不再是 0'
  )
  assert.equal(
    await createBatchApi({ fetcher: async () => json({ code: 40902, message: '状态非法' }, 200) }).retryFailed(1),
    null,
    '200 但信封 code≠0 塌 null'
  )
  assert.equal(
    await createBatchApi({ fetcher: async () => { throw new Error('ECONNREFUSED') } }).retryFailed(1),
    null,
    'fetch 抛错塌 null'
  )
})

// 两个「只回一个数」的跳：抽取的键名各有其主（heartbeat=updated / recallReports=settled），
// 写错键名的症状是永远回 0，而 0 在这里是合法值——泵会据此停摆，看起来像后端坏了。
test('heartbeat 取 updated、recallReports 取 settled，缺字段塌成 0', async () => {
  const api = createBatchApi({
    fetcher: async (path) =>
      json({ code: 0, data: path.includes('heartbeat') ? { updated: 1 } : { settled: 2 } })
  })
  assert.equal(await api.heartbeat(1), 1)
  assert.equal(await api.recallReports(1, [{ detailId: 1, recalled: true }]), 2)
  const empty = createBatchApi({ fetcher: async () => json({ code: 0, data: {} }) })
  assert.equal(await empty.heartbeat(1), 0)
  assert.equal(await empty.recallReports(1, []), 0)
})

test('details 分页参数进 query 串，页码从 1 起', async () => {
  let seenPath = ''
  const api = createBatchApi({ fetcher: async (p) => { seenPath = p; return json({ code: 0, data: { records: [], total: 0, page: 2, pageSize: 50 } }) } })
  await api.details(1, 2, 50)
  assert.equal(seenPath, '/api/batch-send/tasks/1/details?page=2&size=50')
})

// 塌成 null 的三种形状必须各自落到 onError(where, e)，且 where = 那一跳的 path：
// 调用方拿到的返回值全是 null/0，唯一的区别就在这一路回调里。少报任何一种，
// Task 11 的心跳泵就无法把「后端拒了这个迁移」和「后端没起来」分开处理。
test('三种塌法都报到 onError，where 就是那一跳的 path', async () => {
  const seen: { where: string; msg: string }[] = []
  const mk = (fetcher: (p: string) => Promise<Response>): ReturnType<typeof createBatchApi> =>
    createBatchApi({ fetcher, onError: (where, e) => seen.push({ where, msg: String(e) }) })

  await mk(async () => { throw new Error('ECONNREFUSED') }).start(1)
  await mk(async () => json({ code: 40902, message: '状态非法' }, 409)).pause(2)
  await mk(async () => json({ code: 50000, message: 'boom' }, 200)).resume(3)
  await mk(async () => json({ code: 0, message: 'ok' }, 200)).cancel(4)

  assert.deepEqual(seen.map((s) => s.where), [
    '/api/batch-send/tasks/1/start',
    '/api/batch-send/tasks/2/pause',
    '/api/batch-send/tasks/3/resume',
    '/api/batch-send/tasks/4/cancel'
  ])
  assert.match(seen[0].msg, /ECONNREFUSED/)
  assert.match(seen[1].msg, /HTTP 409/, '非 2xx 要把状态码带出来，否则日志里只有 null')
  assert.match(seen[2].msg, /code=50000/, '200 + 非 0 信封要把信封码带出来')
  assert.match(seen[3].msg, /data 缺失/, 'code=0 但没 data 是后端形状变了，不能报成"非 0"')
})

// 宿主的 onError 挂了也不能把"这一跳没成"升级成抛到采集/发送链上——那是全文件的返回值契约。
// 少了 note 里那层 try，这一条会直接 reject 而不是拿到 null/0。
test('onError 自己抛，调用方仍然只拿到 null/0', async () => {
  const api = createBatchApi({
    fetcher: async () => json({ code: 40902, message: '状态非法' }, 409),
    onError: () => { throw new Error('宿主的日志实现挂了') }
  })
  assert.equal(await api.start(1), null)
  assert.equal(await api.heartbeat(1), 0)
})
