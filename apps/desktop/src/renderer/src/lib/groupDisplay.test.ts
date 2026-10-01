// src/renderer/src/lib/groupDisplay.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shortfallPercent,
  gateNote,
  memberAreaState,
  joinTimeCopy,
  exitCell,
  firstSeenCopy
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
