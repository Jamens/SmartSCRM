// src/bridge/whatsapp/groups.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BridgeReport } from '../../shared/chatTypes.ts'
import {
  listGroups,
  snapshotGroup,
  subscribeGroupEvents,
  systemEventsFromRaw,
  toGroupEventWires,
  type GroupsWpp
} from './groups.ts'
import type { WaGroupParticipantChanged } from '../types.ts'

const GROUP = '120363@g.us'

// ---------------------------------------------------------------------------
// 在线事件转译
// ---------------------------------------------------------------------------

test('七种 action 全部转成本项目 event_type，leaver 按 left 收', () => {
  const at = 1700000000
  const map: Array<[WaGroupParticipantChanged['action'], string]> = [
    ['add', 'added'],
    ['join', 'joined'],
    ['remove', 'removed'],
    // 真实 wa-js 的 action 集合里**没有 leave，只有 leaver**
    // （dist/group/events/eventTypes.d.ts：add|remove|demote|promote|leaver|join）。
    // shared 的 eventTypeFromAction 两个都收（防御性），这里按真实值验。
    ['leaver', 'left'],
    ['demote', 'demoted'],
    ['promote', 'promoted']
  ]
  for (const [action, expected] of map) {
    const wires = toGroupEventWires(
      { groupId: GROUP, action, participants: ['8613@c.us'], author: '8611@c.us' },
      at
    )
    assert.equal(wires.length, 1, `${action} 该产出一条`)
    assert.equal(wires[0].eventType, expected)
    assert.equal(wires[0].occurredAtEpochSec, at)
    assert.equal(wires[0].source, 'live_event')
  }
})

test('认不出的 action 不产事件，不猜一个默认类型顶上', () => {
  const wires = toGroupEventWires(
    { groupId: GROUP, action: 'unknown' as WaGroupParticipantChanged['action'], participants: ['8613@c.us'] },
    1700000000
  )
  assert.equal(wires.length, 0)
})

test('没有目标人就不产事件：不知道是谁，别造一条指向不明的流水', () => {
  for (const participants of [undefined, [], ['']]) {
    const wires = toGroupEventWires({ groupId: GROUP, action: 'add', participants }, 1700000000)
    assert.equal(wires.length, 0, `participants=${JSON.stringify(participants)}`)
  }
})

test('一次变动多个人：每人一条，去重键相同但 member_key 不同（uk_event 靠后两列区分）', () => {
  const wires = toGroupEventWires(
    { groupId: GROUP, action: 'add', participants: ['8613@c.us', '8614@c.us'], author: '8611@c.us' },
    1700000000
  )
  assert.equal(wires.length, 2)
  assert.equal(wires[0].dedupKey, wires[1].dedupKey)
  assert.notEqual(wires[0].memberKey, wires[1].memberKey)
  assert.deepEqual(wires.map((w) => w.memberKey), ['8613@c.us', '8614@c.us'])
})

test('操作人与操作人名都带出去，没有就留 null 而不是空串', () => {
  const withAuthor = toGroupEventWires(
    { groupId: GROUP, action: 'remove', participants: ['8613@c.us'], author: '8611@c.us', authorPushName: '群主' },
    1700000000
  )
  assert.equal(withAuthor[0].actorKey, '8611@c.us')
  assert.equal(withAuthor[0].actorName, '群主')

  const noAuthor = toGroupEventWires({ groupId: GROUP, action: 'join', participants: ['8613@c.us'] }, 1700000000)
  assert.equal(noAuthor[0].actorKey, null)
  assert.equal(noAuthor[0].actorName, null)
})

// ---------------------------------------------------------------------------
// 群名单
// ---------------------------------------------------------------------------

test('只收群键，且过滤掉 wa-js 返回数组里的 undefined 项', async () => {
  const wpp = {
    group: {
      getAllGroups: async () => [
        { id: { _serialized: GROUP }, formattedTitle: '验证群' },
        undefined,
        { id: { _serialized: '8613@c.us' }, formattedTitle: '某个单聊' },
        { id: { _serialized: '120364@g.us' }, name: '只用 name 的群' }
      ],
      getParticipants: async () => []
    },
    on: () => ({ off() {} })
  } as unknown as GroupsWpp

  const r = await listGroups(wpp)
  assert.equal(r.ok, true)
  assert.deepEqual(r.groups, [
    { chatKey: GROUP, title: '验证群' },
    { chatKey: '120364@g.us', title: '只用 name 的群' }
  ])
})

test('WPP.group 不可用（页面还没加载完）返回 ok:false，不抛', async () => {
  const r = await listGroups(undefined)
  assert.equal(r.ok, false)
  assert.equal(typeof r.error, 'string')
})

// ---------------------------------------------------------------------------
// 成员快照
// ---------------------------------------------------------------------------

const fakeWpp = (opts: {
  primary?: Array<{ id?: { _serialized?: string }; isAdmin?: boolean; isSuperAdmin?: boolean }>
  secondary?: Array<{ id?: { _serialized?: string }; isAdmin?: boolean }>
  failPrimary?: boolean
}): GroupsWpp =>
  ({
    group: {
      getAllGroups: async () => [],
      getParticipants: async () => {
        if (opts.failPrimary) throw new Error('主源炸了')
        return opts.primary ?? []
      }
    },
    chat: {
      get: () => ({ groupMetadata: { participants: opts.secondary ?? [] } })
    },
    contact: {
      get: (id: string) => ({ pushname: `昵称-${id}` })
    },
    on: () => ({ off() {} })
  }) as unknown as GroupsWpp

test('两方都空一律 ok:false——空名单当成功快照会把整群人判成已退群', async () => {
  for (const wpp of [fakeWpp({}), fakeWpp({ failPrimary: true })]) {
    const r = await snapshotGroup(wpp, GROUP)
    assert.equal(r.ok, false, '空名单绝不能算成功')
  }
})

test('主副两源取并集并去重，主源优先（同一人留主源那条）', async () => {
  const r = await snapshotGroup(
    fakeWpp({
      primary: [{ id: { _serialized: '8613@c.us' } }, { id: { _serialized: '8614@c.us' } }],
      secondary: [{ id: { _serialized: '8614@c.us' } }, { id: { _serialized: '8615@c.us' } }]
    }),
    GROUP
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.participants?.map((p) => p.memberKey), ['8613@c.us', '8614@c.us', '8615@c.us'])
  assert.equal(r.participantCount, 3)
})

test('角色按 isSuperAdmin > isAdmin > member 映射', async () => {
  const r = await snapshotGroup(
    fakeWpp({
      primary: [
        { id: { _serialized: '8613@c.us' }, isSuperAdmin: true },
        { id: { _serialized: '8614@c.us' }, isAdmin: true },
        { id: { _serialized: '8615@c.us' } }
      ]
    }),
    GROUP
  )
  assert.deepEqual(r.participants?.map((p) => p.roleType), ['super', 'admin', 'member'])
})

test('手机号从 member_key 推，显示名从 contact 补', async () => {
  const r = await snapshotGroup(fakeWpp({ primary: [{ id: { _serialized: '8613800000001@c.us' } }] }), GROUP)
  assert.equal(r.participants?.[0].phone, '8613800000001')
  assert.equal(r.participants?.[0].displayName, '昵称-8613800000001@c.us')
})

test('主源炸了但副源有人：仍能出一份可用快照（不因一侧失败就判死）', async () => {
  const r = await snapshotGroup(
    fakeWpp({ failPrimary: true, secondary: [{ id: { _serialized: '8613@c.us' } }] }),
    GROUP
  )
  assert.equal(r.ok, true)
  assert.equal(r.participantCount, 1)
})

// ---------------------------------------------------------------------------
// 系统消息旁路（第二条腿：补离线时段的变更）
// ---------------------------------------------------------------------------

test('群加减人系统消息产事件，source 标 system_message 且去重键锚 msgKey', () => {
  const events = systemEventsFromRaw(
    { type: 'gp2', subtype: 'add', participantIds: ['8613@c.us', '8614@c.us'], t: 1700000000 },
    GROUP,
    'msg-key-1',
    1700009999
  )
  assert.equal(events.length, 2)
  assert.equal(events[0].eventType, 'added')
  assert.equal(events[0].source, 'system_message')
  assert.equal(events[0].dedupKey, 'msg-key-1#8613@c.us')
  // 系统消息自带时间，用消息时间而不是"观测时刻"
  assert.equal(events[0].occurredAtEpochSec, 1700000000)
})

test('退群系统消息产 left，且目标人缺失时兜操作人自己', () => {
  const events = systemEventsFromRaw(
    { type: 'gp2', subtype: 'leave', author: '8613@c.us', t: 1700000000 },
    GROUP,
    'msg-key-2',
    1700009999
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'left')
  assert.equal(events[0].memberKey, '8613@c.us')
})

test('群设置类变更（改名/描述/头像）不产事件——它们不是人的进退', () => {
  for (const subtype of ['subject', 'description', 'picture']) {
    const events = systemEventsFromRaw({ type: 'gp2', subtype, t: 1700000000 }, GROUP, 'k', 1700000000)
    assert.equal(events.length, 0, `subtype=${subtype} 不该产事件`)
  }
})

test('普通聊天消息与掏不出目标人的加减人都不产事件', () => {
  assert.equal(systemEventsFromRaw({ type: 'chat', body: '你好' }, GROUP, 'k1', 1700000000).length, 0)
  assert.equal(systemEventsFromRaw({ type: 'gp2', subtype: 'add' }, GROUP, 'k2', 1700000000).length, 0)
})

test('没有可用的消息时间时退回观测时刻，不产 0 或负值', () => {
  for (const t of [undefined, 0]) {
    const events = systemEventsFromRaw(
      { type: 'gp2', subtype: 'add', participantIds: ['8613@c.us'], t },
      GROUP,
      'k',
      1700009999
    )
    assert.equal(events[0].occurredAtEpochSec, 1700009999, `t=${String(t)} 应退回观测时刻`)
  }
})

// ---------------------------------------------------------------------------
// 订阅
// ---------------------------------------------------------------------------

test('订阅后事件转成 group_event 帧上报', () => {
  const seen: BridgeReport[] = []
  // 用对象持有而不是 let：TS 不追踪闭包里的赋值，直接 let 会把 cb 窄化成 null，调用点报 never。
  const captured: { cb: ((p: WaGroupParticipantChanged) => void) | null } = { cb: null }
  const wpp = {
    on: (_e: string, handler: (p: WaGroupParticipantChanged) => void) => {
      captured.cb = handler
      return { off() {} }
    }
  } as unknown as GroupsWpp

  subscribeGroupEvents(wpp, (r) => seen.push(r))
  captured.cb?.({ groupId: GROUP, action: 'add', participants: ['8613@c.us'] })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].kind, 'group_event')
})

test('没有目标人时不发帧（空帧没必要走一趟 IPC）', () => {
  const seen: BridgeReport[] = []
  // 用对象持有而不是 let：TS 不追踪闭包里的赋值，直接 let 会把 cb 窄化成 null，调用点报 never。
  const captured: { cb: ((p: WaGroupParticipantChanged) => void) | null } = { cb: null }
  const wpp = {
    on: (_e: string, handler: (p: WaGroupParticipantChanged) => void) => {
      captured.cb = handler
      return { off() {} }
    }
  } as unknown as GroupsWpp
  subscribeGroupEvents(wpp, (r) => seen.push(r))
  captured.cb?.({ groupId: GROUP, action: 'add', participants: [] })
  assert.equal(seen.length, 0)
})

test('取消订阅真的调 off；wa-js 没有这个事件时订阅退化成空操作而不是抛', () => {
  let offed = false
  const wpp = { on: () => ({ off() { offed = true } }) } as unknown as GroupsWpp
  const off = subscribeGroupEvents(wpp, () => {})
  off()
  assert.equal(offed, true)

  // 没有 on 也要能调（返回空函数）
  assert.doesNotThrow(() => subscribeGroupEvents(undefined, () => {})())
  // wa-js 抛错（签名变了）也不该让整条桥挂掉
  const throwing = {
    on: () => {
      throw new Error('no such event')
    }
  } as unknown as GroupsWpp
  assert.doesNotThrow(() => subscribeGroupEvents(throwing, () => {}))
})
