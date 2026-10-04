// src/main/services/groupCollect/engine.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GroupCollectEngine,
  type GroupBuildOutcome,
  type GroupCollectDeps,
  type GroupCommand,
  type GroupReply,
  type IngestPayload
} from './engine.ts'
import { GROUP_GAP_MS, MAX_GROUPS_PER_BUILD, RETRY_BACKOFF_MS } from '../../../shared/groupMembers.ts'
import type { GroupParticipantWire } from '../../../shared/groupMembers.ts'

const members = (n: number): GroupParticipantWire[] =>
  Array.from({ length: n }, (_, i) => ({
    memberKey: `8613${String(i).padStart(8, '0')}@c.us`,
    phone: null,
    displayName: null,
    roleType: 'member'
  }))

interface Harness {
  deps: GroupCollectDeps
  sleeps: number[]
  commands: GroupCommand[]
  ingested: IngestPayload[]
  /** sort=stale 读口被调了几次——指定单群那一腿要靠它证明"没多问一跳"。 */
  staleCalls(): number
}

function harness(opts: {
  listOk?: boolean
  /** group_list 这一跳直接 reject（没绑视图 / 命令推不出去）。 */
  listThrows?: boolean
  listGroups?: string[]
  /** chatKey → 第几次调用才成功（1=一次成功，2=重试才成功，0=永不成功）。 */
  succeedOn?: Record<string, number>
  emptyFor?: string[]
  ingestThrows?: boolean
  /**
   * 后端 `sort=stale` 那一页给回的内容。不给就是「该账号一个都没登记」（keys=[]、total=0），
   * 于是所有桥群都算未建档、保桥次序——与接线前的行为一致，既有那几腿才不必跟着改。
   * `'throws'` = 读口失败（后端不可达 / 没登录），泵必须退化成保桥次序而不是放弃整轮。
   */
  stale?: { keys: string[]; total: number } | 'throws'
  /** 读口被调时的 size 观测（截断那一腿要确认问的条数和队列上限是同一个小）。 */
  staleSize?: (size: number) => void
}): Harness {
  const sleeps: number[] = []
  const commands: GroupCommand[] = []
  const ingested: IngestPayload[] = []
  const attempts: Record<string, number> = {}
  let clock = 1_700_000_000_000
  let staleCount = 0

  const deps: GroupCollectDeps = {
    api: {
      ingest: async (p: IngestPayload) => {
        if (opts.ingestThrows) throw new Error('后端不可达')
        ingested.push(p)
        return { reason: 'ok' }
      },
      staleGroups: async (_accountId: number, size: number) => {
        staleCount += 1
        opts.staleSize?.(size)
        if (opts.stale === 'throws') throw new Error('后端不可达')
        return opts.stale ?? { keys: [], total: 0 }
      }
    },
    dispatch: async (cmd: GroupCommand): Promise<GroupReply> => {
      commands.push(cmd)
      if (cmd.kind === 'group_list') {
        if (opts.listThrows) throw new Error('账号没有绑定视图')
        return opts.listOk === false
          ? { kind: 'group_list_result', ok: false, error: 'WPP.group 不可用' }
          : {
              kind: 'group_list_result',
              ok: true,
              groups: (opts.listGroups ?? []).map((k) => ({ chatKey: k, title: `群-${k}` }))
            }
      }
      const key = cmd.chatKey
      attempts[key] = (attempts[key] ?? 0) + 1
      const need = opts.succeedOn?.[key] ?? 1
      if (need === 0 || attempts[key] < need) {
        return { kind: 'group_snapshot_result', chatKey: key, ok: false, error: '拉取失败' }
      }
      if (opts.emptyFor?.includes(key)) {
        return { kind: 'group_snapshot_result', chatKey: key, ok: true, participants: [] }
      }
      return { kind: 'group_snapshot_result', chatKey: key, ok: true, participants: members(3) }
    },
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    log: () => {}
  }
  return { deps, sleeps, commands, ingested, staleCalls: () => staleCount }
}

test('正常一轮：每个群入库一次，群间隔按 GROUP_GAP_MS', async () => {
  const h = harness({ listGroups: ['g1@g.us', 'g2@g.us'] })
  const r: GroupBuildOutcome = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.registered, 2)
  assert.equal(r.snapshotted, 2)
  assert.equal(r.failed, 0)
  assert.equal(r.postedFailed, 0)
  assert.equal(r.truncated, false)
  assert.equal(r.aborted, false)
  assert.equal(r.skipped, null)
  assert.equal(h.ingested.length, 2)
  // 两个群之间各睡一次间隔
  assert.deepEqual(h.sleeps, [GROUP_GAP_MS, GROUP_GAP_MS])
})

test('group_list 答了但 ok:false：list=error + aborted，一个群都不建', async () => {
  const h = harness({ listOk: false, listGroups: [] })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.list, 'error')
  assert.equal(r.aborted, true)
  assert.equal(r.registered, 0)
  assert.equal(h.ingested.length, 0, '连有哪些群都不知道时不能写出孤儿成员行')
  assert.equal(h.commands.filter((c) => c.kind === 'group_snapshot').length, 0)
})

test('group_list 这一跳没答（命令推不出去）：list=silent，与 error 分开', async () => {
  // 分档的理由：silent 该等会话上线，error 是页内能力缺失——下一步动作不同，混成一档就没法给文案。
  const h = harness({ listThrows: true })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.list, 'silent')
  assert.equal(r.aborted, true)
  assert.equal(r.registered, 0)
  assert.equal(h.ingested.length, 0)
})

test('队列超过 MAX_GROUPS_PER_BUILD 就截断，标记 truncated', async () => {
  const many = Array.from({ length: MAX_GROUPS_PER_BUILD + 5 }, (_, i) => `g${i}@g.us`)
  const h = harness({ listGroups: many })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.truncated, true)
  assert.equal(r.attempted, MAX_GROUPS_PER_BUILD)
  assert.equal(r.registered, MAX_GROUPS_PER_BUILD)
})

test('后端 sort=stale 的位置就是队列次序（客户端不重排）', async () => {
  const h = harness({
    listGroups: ['a@g.us', 'b@g.us', 'c@g.us'],
    // 后端按 ISNULL(last_snapshot_at) DESC, last_snapshot_at ASC 给回：c 最旧、b 次之、a 最新
    stale: { keys: ['c@g.us', 'b@g.us', 'a@g.us'], total: 3 }
  })
  await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.deepEqual(h.ingested.map((p) => p.snapshot?.chatKey), ['c@g.us', 'b@g.us', 'a@g.us'],
    '队列没有照后端给回的位置排 ⇒ 泵还在自己猜次序')
  assert.equal(h.staleCalls(), 1, '全量建档只该问一跳 stale 页')
})

test('后端把登记过的群全给回时，桥里没登记过的群排最前（R28/R41 未建档最前）', async () => {
  const h = harness({
    listGroups: ['reg1@g.us', 'never1@g.us', 'reg2@g.us', 'never2@g.us'],
    // total === keys.length ⇒ 全集在手：不在其中的两个群确实一行 chat_group 都没有
    stale: { keys: ['reg2@g.us', 'reg1@g.us'], total: 2 }
  })
  await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.deepEqual(h.ingested.map((p) => p.snapshot?.chatKey),
    ['never1@g.us', 'never2@g.us', 'reg2@g.us', 'reg1@g.us'],
    '从没登记过的群必须排在"已登记但旧"之前——前者是完全没有成员数据')
})

test('后端只给回一页时，已登记且最旧的排前，剩下的保桥次序垫后', async () => {
  const h = harness({
    listGroups: ['x@g.us', 'old@g.us', 'y@g.us'],
    // total > keys.length ⇒ 分不清 x/y 是"没登记"还是"登记了但不够旧"，保守地把它们垫后
    stale: { keys: ['old@g.us'], total: 900 }
  })
  await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.deepEqual(h.ingested.map((p) => p.snapshot?.chatKey), ['old@g.us', 'x@g.us', 'y@g.us'])
})

test('sort=stale 读口失败时退化成保桥次序，整轮照跑（排序是优化不是判定）', async () => {
  const h = harness({ listGroups: ['g1@g.us', 'g2@g.us'], stale: 'throws' })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.aborted, false, '读排序页失败不能把整轮判死')
  assert.equal(r.list, 'ok')
  assert.equal(r.registered, 2)
  assert.deepEqual(h.ingested.map((p) => p.snapshot?.chatKey), ['g1@g.us', 'g2@g.us'])
})

test('问 stale 页的 size 与截断上限同一个小（不然前排之外的位置全是猜的）', async () => {
  let seen = 0
  const h = harness({ listGroups: ['g1@g.us'], staleSize: (s) => { seen = s } })
  await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(seen, MAX_GROUPS_PER_BUILD)
})

test('快照失败重试一次：dispatch 两次、退避 RETRY_BACKOFF_MS，仍失败就跳过这个群', async () => {
  const h = harness({ listGroups: ['bad@g.us'], succeedOn: { 'bad@g.us': 0 } })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.registered, 0)
  assert.equal(r.snapshotted, 0)
  assert.equal(r.failed, 1)
  assert.equal(h.commands.filter((c) => c.kind === 'group_snapshot').length, 2, '只重试一次，不无限重试')
  // 退避一次 + 群间隔一次
  assert.deepEqual(h.sleeps, [RETRY_BACKOFF_MS, GROUP_GAP_MS])
  assert.equal(h.ingested.length, 0)
})

test('重试第二次成功照样入库（失败必须退避后重来，不能当场判死）', async () => {
  const h = harness({ listGroups: ['flaky@g.us'], succeedOn: { 'flaky@g.us': 2 } })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.registered, 1)
  assert.equal(r.snapshotted, 1)
  assert.equal(r.failed, 0)
})

test('空名单不算成功快照：形状 ok 但 participants 是空数组也要判失败', async () => {
  const h = harness({ listGroups: ['empty@g.us'], emptyFor: ['empty@g.us'] })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.registered, 0)
  assert.equal(r.failed, 1)
  assert.equal(h.ingested.length, 0, '空名单进库会把整群人判成已退群')
})

test('入库抛错误记 postedFailed：与"快照没拉到"分开，且不打断后面', async () => {
  const h = harness({ listGroups: ['a@g.us', 'b@g.us'], ingestThrows: true })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  assert.equal(r.registered, 0)
  assert.equal(r.postedFailed, 2, '两个群都试过了，没有中途崩掉')
  assert.equal(r.snapshotted, 2, '快照其实拿到了——"拉到了没记上"与"压根没拉到"不是一回事')
  assert.equal(r.failed, 0)
})

test('同一账号重入直接放弃，标 skipped=busy', async () => {
  const h = harness({ listGroups: ['g1@g.us'] })
  const engine = new GroupCollectEngine(h.deps)
  // 第一轮不 await（卡在 sleep 上），第二轮应当被挡
  const first = engine.runBuildForAccount(1)
  const second = await engine.runBuildForAccount(1)
  assert.equal(second.skipped, 'busy')
  assert.equal(second.registered, 0)
  await first
  // 跑完之后可以再来一轮
  const third = await engine.runBuildForAccount(1)
  assert.equal(third.registered, 1)
})

test('指定单个 chatKey 时只建这一个，且不去问 group_list', async () => {
  const h = harness({ listGroups: [] })
  const r = await new GroupCollectEngine(h.deps).runBuildForAccount(1, 'pick0@g.us')
  assert.equal(r.registered, 1)
  assert.deepEqual(h.ingested.map((p) => p.snapshot?.chatKey), ['pick0@g.us'])
  // 指定群时不该再去问 group_list
  assert.equal(h.commands.filter((c) => c.kind === 'group_list').length, 0)
  // 也不该去问 stale 页：用户点哪一个就补哪一个，排序页对这腿没有意义
  assert.equal(h.staleCalls(), 0)
})
