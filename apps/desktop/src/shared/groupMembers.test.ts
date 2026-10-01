// src/shared/groupMembers.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COVERAGE_MIN,
  classifyGroupSystemMessage,
  eventTypeFromAction,
  exitMethodLabel,
  formatExportTime,
  groupRoleLabel,
  liveEventDedupKey,
  mergeParticipants,
  oneLine,
  snapshotCoverage,
  snapshotIsUsable,
  type GroupParticipantWire,
  type GroupSystemRaw
} from './groupMembers.ts'

const p = (memberKey: string, roleType: GroupParticipantWire['roleType'] = 'member'): GroupParticipantWire => ({
  memberKey,
  phone: null,
  displayName: null,
  roleType
})

// ---------------------------------------------------------------------------
// 在线事件：action → event_type
// ---------------------------------------------------------------------------

test('wa-js 的七种 action 全部有落点，leaver 按 left 收', () => {
  assert.equal(eventTypeFromAction('add'), 'added')
  assert.equal(eventTypeFromAction('join'), 'joined')
  assert.equal(eventTypeFromAction('remove'), 'removed')
  assert.equal(eventTypeFromAction('leave'), 'left')
  assert.equal(eventTypeFromAction('leaver'), 'left')
  assert.equal(eventTypeFromAction('demote'), 'demoted')
  assert.equal(eventTypeFromAction('promote'), 'promoted')
})

test('added 与 joined 是两件事，映射不许把它们并成一个', () => {
  assert.notEqual(eventTypeFromAction('add'), eventTypeFromAction('join'))
  assert.notEqual(eventTypeFromAction('remove'), eventTypeFromAction('leave'))
})

test('认不出的 action 返回 null，不猜一个默认值顶上', () => {
  assert.equal(eventTypeFromAction('unknown_action'), null)
  assert.equal(eventTypeFromAction(''), null)
  assert.equal(eventTypeFromAction(null), null)
  assert.equal(eventTypeFromAction(undefined), null)
})

test('在线事件去重键对同一条事件稳定，且不同 action 不同键', () => {
  const a = liveEventDedupKey('8613@c.us', 1700000000, 'add')
  const b = liveEventDedupKey('8613@c.us', 1700000000, 'add')
  const c = liveEventDedupKey('8613@c.us', 1700000000, 'remove')
  assert.equal(a, b, '同一条事件两次合成必须同键，否则重报会双计')
  assert.notEqual(a, c)
  // 没有操作人也要能合成：用占位符而不是留下空段造成 'x|1700|add' 与 '|1700|add' 歧义。
  assert.equal(liveEventDedupKey(null, 1700000000, 'add'), '-|1700000000|add')
})

// ---------------------------------------------------------------------------
// 系统消息分类
// ---------------------------------------------------------------------------

// 下面几条都带 `participantIds`：没有目标人的加减人消息按"不知道是谁"处理（见后一条），
// 这里要验的是 event_type 的归类，所以先把目标人给足。
const withTarget = (subtype: string): GroupSystemRaw => ({
  type: 'gp2',
  subtype,
  participantIds: ['8613@c.us']
})

test('加人族出 added，自己进来出 joined——两族不并成一种', () => {
  assert.equal(classifyGroupSystemMessage(withTarget('add'))?.eventType, 'added')
  assert.equal(classifyGroupSystemMessage(withTarget('invite'))?.eventType, 'added')
  assert.equal(classifyGroupSystemMessage(withTarget('join'))?.eventType, 'joined')
  assert.notEqual(
    classifyGroupSystemMessage(withTarget('add'))?.eventType,
    classifyGroupSystemMessage(withTarget('join'))?.eventType
  )
})

test('减人族：被踢出 removed，自己退出 left', () => {
  assert.equal(classifyGroupSystemMessage(withTarget('remove'))?.eventType, 'removed')
  assert.equal(classifyGroupSystemMessage(withTarget('kick'))?.eventType, 'removed')
  assert.equal(classifyGroupSystemMessage(withTarget('leave'))?.eventType, 'left')
  assert.equal(classifyGroupSystemMessage(withTarget('exit'))?.eventType, 'left')
})

test('升降级出 promoted/demoted，不退化成普通进退', () => {
  assert.equal(classifyGroupSystemMessage(withTarget('promote'))?.eventType, 'promoted')
  assert.equal(classifyGroupSystemMessage(withTarget('demote'))?.eventType, 'demoted')
  // demote 先于 remove 判定：它不该被并进"减人"。
  assert.notEqual(classifyGroupSystemMessage(withTarget('demote'))?.eventType, 'removed')
})

test('加减人消息掏不出目标人时一律不产事件：不知道是谁，就别造一条指向不明的流水', () => {
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'add' }), null)
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'remove' }), null)
  // 唯一例外是自己退群/被踢：那时退的人就是操作人自己，见后一条。
})

test('群设置类变更不进流水：改名/描述/头像都被挡下', () => {
  for (const subtype of ['subject', 'description', 'picture', 'announcement', 'messages_policy']) {
    assert.equal(
      classifyGroupSystemMessage({ type: 'gp2', subtype }),
      null,
      `${subtype} 是群设置不是人的进退，不该产事件`
    )
  }
})

test('普通聊天消息不是群变动', () => {
  assert.equal(classifyGroupSystemMessage({ type: 'chat', subtype: null }), null)
  assert.equal(classifyGroupSystemMessage({}), null)
})

test('目标人从 participantIds/participants/recipients 三处取，并剔除群自身', () => {
  const r = classifyGroupSystemMessage({
    type: 'gp2',
    subtype: 'add',
    chatKey: '120363@g.us',
    participantIds: ['86131@c.us', '120363@g.us', '86132@c.us']
  })
  assert.deepEqual(r?.targets, ['86131@c.us', '86132@c.us'])
})

test('wid 对象形态（_serialized）也要能掏出目标人', () => {
  const r = classifyGroupSystemMessage({
    type: 'gp2',
    subtype: 'add',
    participants: [{ _serialized: '86133@c.us' }]
  })
  assert.deepEqual(r?.targets, ['86133@c.us'])
})

test('退群没有目标人字段时，退的那个人就是操作人自己', () => {
  const r = classifyGroupSystemMessage({
    type: 'gp2',
    subtype: 'leave',
    chatKey: '120363@g.us',
    author: '86134@c.us'
  })
  assert.equal(r?.eventType, 'left')
  assert.deepEqual(r?.targets, ['86134@c.us'])
  assert.equal(r?.actorKey, '86134@c.us')
})

test('既没有目标人也兜不出操作人时不产事件——宁可缺一条，也不造一条指向不明的', () => {
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'remove' }), null)
})

// ---------------------------------------------------------------------------
// 快照并集与"能不能算成功"
// ---------------------------------------------------------------------------

test('主副两源按 memberKey 取并集并去重', () => {
  const merged = mergeParticipants([p('a@c.us'), p('b@c.us')], [p('b@c.us'), p('c@c.us')])
  assert.deepEqual(
    merged.map((x) => x.memberKey),
    ['a@c.us', 'b@c.us', 'c@c.us']
  )
})

test('主源优先：同一人在两源都出现时留主源那条（副源不含进群时间，只能补漏不能改写）', () => {
  const merged = mergeParticipants([p('a@c.us', 'admin')], [p('a@c.us', 'member')])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].roleType, 'admin')
})

test('空名单不算成功快照——否则一次拉取失败会把整群人判成已退群', () => {
  assert.equal(snapshotIsUsable([]), false)
  assert.equal(snapshotIsUsable(mergeParticipants(null, null)), false)
  assert.equal(snapshotIsUsable(mergeParticipants([], [])), false)
  assert.equal(snapshotIsUsable([p('a@c.us')]), true)
})

// ---------------------------------------------------------------------------
// 覆盖率闸
// ---------------------------------------------------------------------------

test('首次建档：分母缺失与分母为 0 同一处理，都放行且不产生覆盖率', () => {
  const fromNull = snapshotCoverage(null, 42)
  const fromZero = snapshotCoverage(0, 42)
  assert.deepEqual(fromNull, { reconciled: true, coverage: null, reason: 'first_build' })
  assert.deepEqual(fromZero, fromNull, '0 不等于"从没建过档"在数据上是同一件事')
})

test('覆盖率达标放行，不达标拦住退群判定', () => {
  const ok = snapshotCoverage(100, 80)
  assert.equal(ok.reason, 'ok')
  assert.equal(ok.reconciled, true)

  const low = snapshotCoverage(100, 10)
  assert.equal(low.reason, 'coverage_too_low')
  assert.equal(low.reconciled, false, '人少了九成，绝不能拿它去判谁退群')
  assert.notEqual(ok.reason, low.reason)
})

test('闸值本身是 0.6：恰好等于算达标，差一点就不算', () => {
  assert.equal(snapshotCoverage(100, 60).reconciled, true)
  assert.equal(snapshotCoverage(100, 59).reconciled, false)
  assert.equal(COVERAGE_MIN, 0.6)
})

test('人数变多不拦：覆盖率大于 1 也是"覆盖够了"，不是异常', () => {
  const grew = snapshotCoverage(10, 30)
  assert.equal(grew.reason, 'ok')
  assert.equal(grew.reconciled, true)
  assert.equal(grew.coverage, 3)
})

// ---------------------------------------------------------------------------
// R46：时刻文本与中文标签各只有一份作者，导出表格与渲染层名单共用
// ---------------------------------------------------------------------------

test('formatExportTime：T 换空格并截到秒，不解析、不换算时区', () => {
  assert.equal(formatExportTime('2026-09-30T12:00:03.417'), '2026-09-30 12:00:03')
  assert.equal(formatExportTime('2026-09-30T12:00:00'), '2026-09-30 12:00:00')
  // 不带 Z 的墙钟串不许被 new Date 按本地时区重读，所以这里只做字符串变换
  assert.equal(formatExportTime('2026-09-30T12:00:00Z'), '2026-09-30 12:00:00')
  // 长度不足（后端以后只给到分）原样给回，不补零
  assert.equal(formatExportTime('2026-09-30T12:00'), '2026-09-30 12:00')
  assert.equal(formatExportTime(null), '')
  assert.equal(formatExportTime(''), '')
})

test('groupRoleLabel / exitMethodLabel：未知取值回落原词，null 给破折号', () => {
  assert.equal(groupRoleLabel('member'), '成员')
  assert.equal(groupRoleLabel('admin'), '管理员')
  assert.equal(groupRoleLabel('super'), '群主')
  assert.equal(groupRoleLabel(null), '—')
  assert.equal(groupRoleLabel('owner'), 'owner', '平台加了新角色时导出不许留空白')

  assert.equal(exitMethodLabel('removed'), '被移出')
  assert.equal(exitMethodLabel('left'), '自行退群')
  assert.equal(exitMethodLabel('snapshot_absent'), '快照中已不在')
  assert.equal(exitMethodLabel(null), '—')
  assert.equal(exitMethodLabel('kicked_v2'), 'kicked_v2')
})

test('oneLine：换行与 C0 控制字符收成空格，长度有上限', () => {
  assert.equal(oneLine('a\nb'), 'a b')
  // \v \f 也算换行（Chrome 的 console 会断行），留着就等于允许伪造日志行
  assert.equal(oneLine('a\x0bb\x0cc'), 'a b c')
  assert.equal(oneLine(undefined), '')
  assert.equal(oneLine('x'.repeat(300)).length, 200)
})
