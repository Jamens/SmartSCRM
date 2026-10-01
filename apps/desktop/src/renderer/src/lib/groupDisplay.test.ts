// src/renderer/src/lib/groupDisplay.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
// shared 的运行时值走相对路径 + `.ts`（node --test 不解析 `@shared/*`）；只用类型的留别名。
import { MAX_GROUPS_PER_BUILD, exitMethodLabel } from '../../../shared/groupMembers.ts'
import type { GroupBuildOutcome, GroupExportResult } from '@shared/groupMembers'
import {
  actorCopy,
  buildFailureNotes,
  eventTypeCopy,
  exitCell,
  exportOutcomeCopy,
  firstSeenCopy,
  firstSeenNote,
  gateNote,
  inGroupCopy,
  joinTimeCopy,
  memberAreaCopy,
  memberAreaShort,
  memberAreaState,
  shortfallPercent,
  sourceCopy,
  timeCopy,
  tooManyCopy
} from './groupDisplay.ts'

test('shortfallPercent：覆盖率换成「少 x%」，一位小数', () => {
  assert.equal(shortfallPercent(0.4), 60)
  assert.equal(shortfallPercent(0.9333), 6.7) // 四舍五入到一位，浮点尾巴不外泄
  assert.equal(shortfallPercent(1), 0)
})

test('gateNote 只在 coverage_too_low 出文案', () => {
  assert.equal(gateNote('coverage_too_low', 0.4), '本次快照人数较上次少 60%，未做退群判定')
  assert.equal(gateNote('ok', 1), null)
  assert.equal(gateNote('first_build', null), null) // §8：首次建档正常显示
  assert.equal(gateNote('no_snapshot', null), null) // 这一格是"没带快照"，不是"少人了"
  assert.equal(gateNote(null, null), null)
})

test('gateNote：coverage 缺失时不许编一个百分比出来', () => {
  // 判据：reason 说低覆盖但读数没落库（列可空）——宁可不显示标注，也不显示"少 NaN%"
  assert.equal(gateNote('coverage_too_low', null), '本次快照人数低于上次，未做退群判定')
})

test('memberAreaState：非 WhatsApp 与从没快照过的群分开', () => {
  assert.equal(memberAreaState({ platform: 'telegram', snapshotCount: 5 }), 'unavailable')
  assert.equal(memberAreaState({ platform: 'whatsapp', snapshotCount: 0 }), 'never_built')
  assert.equal(memberAreaState({ platform: 'whatsapp', snapshotCount: 3 }), 'built')
})

test('joinTimeCopy：进群时间只取 latestJoinAt，空就空（§11 第 2 条）', () => {
  assert.equal(joinTimeCopy({ latestJoinAt: '2026-09-30T12:00:00' }), '2026-09-30 12:00:00')
  assert.equal(joinTimeCopy({ latestJoinAt: null }), '—')
})

test('exitCell：推定退群没有时间，退出方式给"快照中已不在"（§8 第四行）', () => {
  // 中文词从 shared 的 `exitMethodLabel` 来（R46：那一份表在 shared 里，
  // 这里断言的是"接线接对了"，不是"这里再写一遍词"）。
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'snapshot_absent', latestLeaveAt: null }), {
    time: '—',
    method: '快照中已不在'
  })
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'left', latestLeaveAt: '2026-09-30T12:00:00' }), {
    time: '2026-09-30 12:00:00',
    method: '自行退群'
  })
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'removed', latestLeaveAt: null }), {
    time: '—',
    method: '被移出'
  }) // 事件证据在，时间戳缺——仍是"—"，不许拿 first_seen 补
  // 判别力：exitMethod 为 null 时**不许**把 `exitMethodLabel(null)` 的 '—' 当成"有退出方式"显示出来，
  // 否则每一行在群成员都会多出一格"—"，读起来像"退群方式未知"。
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: null, latestLeaveAt: null }), { time: '', method: '' })
  // 在群的人这两格一律空着：`exit_method` 是历史值（上次退群留下的），不能显示成"现在退群了"。
  assert.deepEqual(exitCell({ isInGroup: true, exitMethod: 'left', latestLeaveAt: '2026-09-30T12:00:00' }), {
    time: '',
    method: ''
  })
})

test('firstSeenCopy 的措辞是"首次见到"，不是"进群时间"', () => {
  assert.equal(firstSeenCopy('2026-09-30T12:00:00'), '2026-09-30 12:00:00')
  assert.equal(firstSeenCopy(null), '—')
})

// ---------------------------------------------------------------------------
// Task 16：§8 全部文案口径收成纯函数
// ---------------------------------------------------------------------------

test('timeCopy：空给 —，有值只换形不换算', () => {
  assert.equal(timeCopy(null), '—')
  assert.equal(timeCopy(''), '—')
  assert.equal(timeCopy('2026-09-30T12:00:00.123'), '2026-09-30 12:00:00')
})

test('memberAreaCopy 与 memberAreaShort：同一档两句长短，built 一字不出', () => {
  assert.equal(memberAreaCopy('unavailable'), '该平台的成员采集尚未开通')
  assert.equal(memberAreaCopy('never_built'), '这个群还没建过档——名单为空不等于群里没人')
  assert.equal(memberAreaCopy('built'), '')
  assert.equal(memberAreaShort('unavailable'), '未开通')
  assert.equal(memberAreaShort('never_built'), '未建档')
  assert.equal(memberAreaShort('built'), '')
})

test('eventTypeCopy：六个码全有词，未知值回落原词', () => {
  assert.equal(eventTypeCopy('added'), '被加入')
  assert.equal(eventTypeCopy('joined'), '主动加入')
  assert.equal(eventTypeCopy('left'), '自行退群')
  assert.equal(eventTypeCopy('removed'), '被移出')
  assert.equal(eventTypeCopy('promoted'), '升为管理员')
  assert.equal(eventTypeCopy('demoted'), '降为成员')
  assert.equal(eventTypeCopy('invited_join'), 'invited_join') // 平台以后给新值时不许显示空白
})

test('eventTypeCopy 与 shared 的退出方式词不许分家（R51 的锁）', () => {
  // 同一个人"被移出"，流水里叫一个词、名单里叫另一个词，是同一事实两个作者的结果。
  // 这两行断言就是那条漂移的守门人：改任一侧都会红。
  assert.equal(eventTypeCopy('left'), exitMethodLabel('left'))
  assert.equal(eventTypeCopy('removed'), exitMethodLabel('removed'))
  assert.equal(eventTypeCopy('added'), exitMethodLabel('added'))
})

test('sourceCopy：两种来源 + 未知回落', () => {
  assert.equal(sourceCopy('system_message'), '系统消息')
  assert.equal(sourceCopy('live_event'), '实时事件')
  assert.equal(sourceCopy('whatever'), 'whatever')
})

test('inGroupCopy：钉的是 Java 导出侧已经用过的那一对（R46 的跨语言版）', () => {
  assert.equal(inGroupCopy(true), '是')
  assert.equal(inGroupCopy(false), '否')
})

test('actorCopy：名字优先，其次键，两个都没有才给 —', () => {
  assert.equal(actorCopy({ actorName: '张三', actorKey: '86138@c.us' }), '张三')
  assert.equal(actorCopy({ actorName: null, actorKey: '86138@c.us' }), '86138@c.us')
  assert.equal(actorCopy({ actorName: null, actorKey: null }), '—')
})

test('firstSeenNote：只在"没有进群时间、但有首次见到"时出话（§8 第三行、§11 第 2 条）', () => {
  assert.equal(
    firstSeenNote({ latestJoinAt: null, firstSeenAt: '2026-09-30T12:00:00' }),
    '首次见到 2026-09-30 12:00:00'
  )
  assert.equal(firstSeenNote({ latestJoinAt: '2026-09-01T00:00:00', firstSeenAt: '2026-09-30T12:00:00' }), '')
  assert.equal(firstSeenNote({ latestJoinAt: null, firstSeenAt: null }), '')
})

test('exportOutcomeCopy：六种结论 + 宿主没答，七种来路七句话', () => {
  const r = (over: Partial<GroupExportResult>): GroupExportResult => ({
    reason: 'saved',
    path: 'D:/x.xlsx',
    rows: 12,
    bytes: 3456,
    ...over
  })
  assert.match(exportOutcomeCopy(r({})), /^已导出 12 行/)
  assert.equal(exportOutcomeCopy(r({ reason: 'cancel', path: null, rows: 0 })), '已取消保存，什么都没写')
  assert.equal(
    exportOutcomeCopy(r({ reason: 'empty_keys', path: null, rows: 0 })),
    '没有可导出的群：先勾选至少一个'
  )
  assert.equal(exportOutcomeCopy(r({ reason: 'too_many', path: null, rows: 0 })), tooManyCopy())
  assert.equal(
    exportOutcomeCopy(r({ reason: 'no_rows', path: null, rows: 0 })),
    '这些群还没有成员名单，先建一次档再导'
  )
  assert.match(exportOutcomeCopy(r({ reason: 'failed', path: null, rows: 0 })), /导出没成/)
  // 判别力：宿主没答与后端报失败是两句话。塌成一句就会把"这个构建没接 IPC"读成"重试一下就好"。
  assert.notEqual(
    exportOutcomeCopy(null),
    exportOutcomeCopy(r({ reason: 'failed', path: null, rows: 0 }))
  )
  assert.match(exportOutcomeCopy(null), /宿主/)
})

test('tooManyCopy：不传 count 时只有干句（宿主那一路），传了才带「当前勾了 n 个」（前拦那一路）', () => {
  assert.match(tooManyCopy(), /一次最多导出 50 个群/)
  assert.equal(tooManyCopy(53), '一次最多导出 50 个群，当前勾了 53 个')
})

const outcome = (over: Partial<GroupBuildOutcome> = {}): GroupBuildOutcome => ({
  accountId: 1,
  skipped: null,
  list: 'ok',
  registered: 3,
  attempted: 3,
  snapshotted: 3,
  postedFailed: 0,
  failed: 0,
  skippedFinal: 0,
  truncated: false,
  aborted: false,
  ...over
})

test('buildFailureNotes：skipped 只出一句；计数各占一行；成功出空数组', () => {
  // 早退那一格是判据：不早退的实现会对"上一轮还在跑"同时吐出 skipped + list:'silent' 两行，
  // 而那一轮根本没去读群名单，"页内没答"是假话。
  assert.deepEqual(
    buildFailureNotes(
      outcome({ skipped: 'busy', list: 'silent', registered: 0, attempted: 0, snapshotted: 0 })
    ),
    ['这个账号已有一轮建档在跑，这一轮没开']
  )
  assert.deepEqual(
    buildFailureNotes(
      outcome({ skipped: 'no_view', list: 'silent', registered: 0, attempted: 0, snapshotted: 0 })
    ),
    ['这个账号的窗口没挂着，采集下不去']
  )
  assert.deepEqual(buildFailureNotes(outcome({ list: 'silent' })), [
    '页内没回答群名单（桥没就绪或 wa-js 没答），这一轮没建档'
  ])
  assert.deepEqual(buildFailureNotes(outcome({ list: 'error' })), ['群名单没读到（页内报错了）'])
  assert.deepEqual(
    buildFailureNotes(outcome({ aborted: true, failed: 2, postedFailed: 1, truncated: true })),
    [
      '这一轮被中止（账号掉线或退出），已经入库的那部分仍算数',
      `这一轮只跑了 ${MAX_GROUPS_PER_BUILD} 个群，剩下的等下一次触发`,
      '2 个群的快照没成',
      '1 个群入库没成（后端没答或报错）'
    ]
  )
  assert.deepEqual(buildFailureNotes(outcome()), [])
  assert.deepEqual(buildFailureNotes(outcome({ skippedFinal: 2 })), []) // 泵跳过已解散群不是失败
  assert.equal(buildFailureNotes(null).length, 1)
  assert.match(buildFailureNotes(null)[0] ?? '', /宿主/)
})
