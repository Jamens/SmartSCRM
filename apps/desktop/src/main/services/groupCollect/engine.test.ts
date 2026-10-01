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
}): Harness {
  const sleeps: number[] = []
  const commands: GroupCommand[] = []
  const ingested: IngestPayload[] = []
  const attempts: Record<string, number> = {}
  let clock = 1_700_000_000_000

  const deps: GroupCollectDeps = {
    api: {
      ingest: async (p: IngestPayload) => {
        if (opts.ingestThrows) throw new Error('后端不可达')
        ingested.push(p)
        return { reason: 'ok' }
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
    log: () => {},
    snapshotAtOf: () => null
  }
  return { deps, sleeps, commands, ingested }
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

test('从没建过档的排前面，其余按上次快照时间升序', async () => {
  const h = harness({ listGroups: ['old@g.us', 'never@g.us', 'new@g.us'] })
  const at: Record<string, number | null> = { 'old@g.us': 1000, 'new@g.us': 9000, 'never@g.us': null }
  h.deps.snapshotAtOf = (k: string) => at[k] ?? null
  await new GroupCollectEngine(h.deps).runBuildForAccount(1)
  const order = h.ingested.map((p) => p.snapshot?.chatKey)
  assert.deepEqual(order, ['never@g.us', 'old@g.us', 'new@g.us'])
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
})
