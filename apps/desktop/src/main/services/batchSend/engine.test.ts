// src/main/services/batchSend/engine.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BatchEngine } from './engine.ts'
import type { BatchApi, ReportItem } from './batchApi.ts'
import type { BatchDetail, BatchTask } from '../../../shared/batchSend.ts'
import type { EngineDeps, SendOutcome } from './engine.ts'

const task = (over: Partial<BatchTask> = {}): BatchTask => ({
  id: 1, name: 't', platform: 'whatsapp', dryRun: true, status: 'running',
  accountIds: [1, 2], contents: ['a', 'b'],
  msgIntervalMin: 0, msgIntervalMax: 0, chatIntervalMin: 0, chatIntervalMax: 0,
  totalCount: 0, sentCount: 0, failCount: 0, ...over
})
const row = (id: number, seq: number, accountId: number, chatKey: string, contentIndex = 0): BatchDetail => ({
  id, taskId: 1, seq, accountId, chatKey, contentIndex, body: 'x', sendStatus: 'pending', recallStatus: 'none'
})

/**
 * 记账用的假 api：记录每一跳上报。`reports` **必须回一份非空 `BatchProgress`**——
 * 引擎那一侧的判据是 `send()` 里的 `(await api.reports(...)) !== null`，`null` 在它眼里就是
 * "后端没收下，整批进积压"。回 `null` 的用例照样能看 `calls` 变长，于是"报出去了"这件事
 * 一次都没发生过而没人报警（本计划第一版草稿就写成 `return null`，三处已改）。
 */
// 返回类型不写在这里：`api` 只以 `as unknown as BatchApi` 进 EngineDeps，显式标一遍会把
// 12 跳的桩形状钉死、用例里 `api.reports = ...` 那处覆盖反而套不进去。与本目录 batchApi.ts
// 同一规则（@typescript-eslint/explicit-function-return-type）的仓库惯例处理。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function fakeApi() {
  const calls: { items: ReportItem[]; allHalted: boolean }[] = []
  const api = {
    start: async () => null,
    pause: async () => null,
    resume: async () => null,
    cancel: async () => null,
    task: async () => null,
    details: async () => null,
    heartbeat: async () => 1,
    retryFailed: async () => 0,
    recall: async () => ({ eligible: [], rejected: [] }),
    recallReports: async () => 0,
    reconcile: async () => null,
    reports: async (_taskId: number, items: ReportItem[], allHalted: boolean) => {
      calls.push({ items, allHalted })
      // 非空 = 这一跳被后端收下了：积压只在收不下时才涨（见上面那段注释）。
      return { sentCount: items.length, failCount: 0, totalCount: 20, status: 'running' }
    }
  }
  return { calls, api }
}

/** 睡一步就计数，不真等：断言"跑了几条"与"取了几个间隔"。 */
function fakeDeps(api: ReturnType<typeof fakeApi>['api'], over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    api: api as unknown as BatchApi,
    dispatch: async (): Promise<SendOutcome> => ({ ok: true, msgKey: `k${Math.random()}` }),
    viewIdOf: (accountId) => `view-${accountId}`,
    sleep: async () => {},
    rand: () => 0.5,
    // 固定时钟：success 那一跳的 sentAtEpochSec = 1_700_000_000（测试不靠墙上时间）。
    now: () => 1_700_000_000_000,
    log: () => {},
    ...over
  }
}

test('账号并行、账号内串行：每条明细都被投料一次', async () => {
  const { calls, api } = fakeApi()
  const seen: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => { seen.push(d.id); return { ok: true, msgKey: `k${d.id}` } }
  }))
  await engine.start(task({ accountIds: [1, 2] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a'), row(3, 1, 2, 'b')])
  assert.deepEqual(seen.slice().sort((x, y) => x - y), [1, 2, 3])
  const items = calls.flatMap((c) => c.items)
  assert.equal(items.length, 6, '每条先 sending 后终态，两跳')
  assert.ok(items.every((i) => typeof i.detailId === 'number'))
  // 上面那三句只看 `calls` 变没变长，而 `calls` 在 `reports` 返回什么之前就先 push 了。
  // 少了下面这两句，把 `fakeApi` 的 `reports` 改回 `return null` 时八条用例照样全绿——
  // 引擎会以为"后端没收下"，把每一跳都塞进积压，于是"报出去了"这个事实一次都没被证过。
  // 判据落在积压侧：正常路径一条都不该积压，所以 flushBacklog 之后重报数必须是 0。
  const replayed: ReportItem[] = []
  api.reports = async (_t: number, batch: ReportItem[]) => {
    replayed.push(...batch)
    return { sentCount: batch.length, failCount: 0, totalCount: 20, status: 'running' }
  }
  await engine.flushBacklog()
  assert.equal(replayed.length, 0, '正常路径不该有任何上报落到积压里等重报')
})

test('同账号串行：一条在飞时不会有第二条从同一账号出去', async () => {
  const { api } = fakeApi()
  let inFlight = 0
  let maxInFlight = 0
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 0))
      inFlight -= 1
      return { ok: true, msgKey: `k${d.id}` }
    },
    viewIdOf: (a) => `view-${a}`
  }))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1)])
  assert.equal(maxInFlight, 1, '同账号并发 = 撞锁')
})

test('间隔取的是随机值且落在区间内：同人相邻两条走 msg，换人走 chat', async () => {
  const { api } = fakeApi()
  const gaps: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    sleep: async (ms) => { gaps.push(ms) },
    rand: () => 0
  }))
  await engine.start(task({ accountIds: [1], msgIntervalMin: 3, msgIntervalMax: 8, chatIntervalMin: 5, chatIntervalMax: 15 }),
    [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b')])
  // 三条明细之间有 2 个 gap：a→a 是 msg(3s)，a→b 是 chat(5s)；最后一条之后不再等。
  assert.deepEqual(gaps, [3000, 5000])
})

test('连续 3 条失败熔断该账号：只停它，别的账号继续跑完', async () => {
  const { calls, api } = fakeApi()
  const hit: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => {
      hit.push(d.id)
      // 账号 1 的前三条全失败（熔断线 = 3，所以第三条投完料才判熔断），第四条起被跳过；账号 2 成功。
      return d.accountId === 1 ? { ok: false, error: 'SEND_FAILED', detail: 'x' } : { ok: true, msgKey: 'k' }
    }
  }))
  await engine.start(task({ accountIds: [1, 2] }), [
    row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b'), row(5, 4, 1, 'a'), row(4, 1, 2, 'c')
  ])
  const last = calls.at(-1)
  assert.ok(!hit.includes(5), '账号 1 熔断后剩余条目不该再投料')
  // 两条泵并发，跨账号的先后不确定，所以只断言"投过哪四条"这个集合。
  assert.deepEqual(hit.slice().sort((x, y) => x - y), [1, 2, 3, 4], '熔断线之前的三条 + 另一账号一条')
  const skipped = calls.flatMap((c) => c.items).filter((i) => i.sendStatus === 'skipped')
  assert.deepEqual(skipped.map((i) => i.detailId), [5])
  assert.equal(skipped[0].errorCode, 'ACCOUNT_HALT')
  // success 那一跳来自账号 2 的泵；`calls.at(-1)` 是 settle 那批——它按设计 items 恒为 []
  // （见 engine.ts 里"收尾那一跳只带结论"那条注释），所以"报没报成 success"只能在全部 items 里找，
  // 而 allHalted 只在 settle 那一批才有真值，两句各看各的，不能都挂在 last 上。
  assert.ok(calls.flatMap((c) => c.items).some((i) => i.detailId === 4 && i.sendStatus === 'success'),
    '账号 2 那一条要带着 success 报出去')
  assert.ok(last?.allHalted === false, '还有一个账号跑完了，不是全停')
})

test('全部账号熔断 → 收尾那一跳 allHalted=true（后端据此把 running 打成 error）', async () => {
  const { calls, api } = fakeApi()
  const engine = new BatchEngine(fakeDeps(api, { dispatch: async () => ({ ok: false, error: 'BRIDGE_OFFLINE' }) }))
  // 三条都失败才够熔断线：单条失败只算一次失败，不该判成全停。
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b')])
  assert.equal(calls.at(-1)?.allHalted, true)
  // 熔断正好落在最后一行，剩余条目是零：那一跳不该发。空 items 是 `settle` 的专用形状
  // （只带结论、不带明细），多一条就让人分不清"这是收尾结论"还是"给零条报 skipped"。
  assert.equal(calls.filter((c) => c.items.length === 0).length, 1, '空 items 的跳只允许收尾那一条')
})

test('TIMEOUT 落 unknown 而不是 failed（重发不可回收，这一行只能人判）', async () => {
  const { calls, api } = fakeApi()
  const engine = new BatchEngine(fakeDeps(api, { dispatch: async () => ({ ok: false, error: 'TIMEOUT' }) }))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a')])
  const finals = calls.flatMap((c) => c.items).filter((i) => i.sendStatus !== 'sending')
  assert.deepEqual(finals.map((i) => i.sendStatus), ['unknown'])
})

test('后端不可达时进积压，恢复后按序重报，不丢结论也不重复投料', async () => {
  const sent: ReportItem[] = []
  let down = true
  const { api } = fakeApi()
  api.reports = async (_t: number, items: ReportItem[]) => {
    if (down) throw new Error('ECONNREFUSED')
    sent.push(...items)
    // 这里也必须回非空：`flushBacklog()` 是按 `send()` 的返回值决定"倒得动倒不动"的，
    // 回 null 的话它倒完第一条就把整段原序塞回去，下面那句 `sent.length >= 2` 永远不成立。
    return { sentCount: items.length, failCount: 0, totalCount: 20, status: 'running' }
  }
  const engine = new BatchEngine(fakeDeps(api))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a')])
  assert.equal(sent.length, 0, '后端在地下没有任何一跳成功')
  down = false
  await engine.flushBacklog()
  assert.ok(sent.length >= 2, '积压的 sending + 终态两跳都被重报')
})

test('stop() 之后队列不再投料，剩余 pending 一条都不发', async () => {
  const { calls, api } = fakeApi()
  let n = 0
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async () => { n += 1; await new Promise((r) => setTimeout(r, 5)); return { ok: true, msgKey: 'k' } }
  }))
  const running = engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1)])
  await new Promise((r) => setTimeout(r, 1))
  engine.stop()
  await running
  assert.ok(n <= 1, `stop 之后还在投料：n=${n}`)
  // 标题里"一条都不发"靠这句才成立：引擎不许替没跑的条目写 skipped。
  // 这不是抠字眼——`skipped` 是没有回程的终态（retryFailed 只复位 failed、buildQueues 不再捡它），
  // 暂停要是把剩余条目报成 skipped，resume 就只剩空队列，任务会被判成"发完了"。
  const skipped = calls.flatMap((c) => c.items).filter((i) => i.sendStatus === 'skipped')
  assert.deepEqual(skipped.map((i) => i.detailId), [], '暂停要留 pending 给 resume')
})
