// src/bridge/whatsapp/groupOps.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinGroup, kickParticipants, previewInvite, type GroupOpsWpp } from './groupOps.ts'

/** 造只带指定能力的假 WPP：getAllGroups/getParticipants 是 WppGroupApi 的必填项，补空实现。 */
const wppOf = (group: Partial<NonNullable<GroupOpsWpp['group']>>): GroupOpsWpp => ({
  group: { getAllGroups: async () => [], getParticipants: async () => [], ...group }
})

// ===== B18 加群 =====

test('joinGroup 成功回填 groupId', async () => {
  const wpp = wppOf({ join: async () => ({ id: 'g1@g.us', pendingApproval: false }) })
  const r = await joinGroup(wpp, 'CODE1')
  assert.equal(r.ok, true)
  assert.equal(r.groupId, 'g1@g.us')
  assert.equal(r.pendingApproval, false)
})

test('joinGroup pendingApproval 也算成功（已提交，不该重试）', async () => {
  const wpp = wppOf({ join: async () => ({ id: 'g1@g.us', pendingApproval: true }) })
  const r = await joinGroup(wpp, 'CODE1')
  assert.equal(r.ok, true, '进了待审批是提交成功，判失败会重复提交审核申请')
  assert.equal(r.pendingApproval, true)
})

test('joinGroup 邀请码失效→失败带原因、不抛', async () => {
  const wpp = wppOf({ join: async () => { throw new Error('invite code expired') } })
  const r = await joinGroup(wpp, 'BAD')
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /expired/)
})

test('joinGroup WPP 不可用/空码→ok:false 不抛', async () => {
  assert.equal((await joinGroup(undefined, 'C')).ok, false)
  assert.equal((await joinGroup({}, 'C')).ok, false)
  assert.equal((await joinGroup(wppOf({}), 'C')).ok, false)
  assert.equal((await joinGroup(wppOf({ join: async () => ({ id: 'g', pendingApproval: false }) }), '')).ok, false)
})

test('joinGroup join 未返回 groupId→判失败', async () => {
  const wpp = wppOf({ join: async () => ({ id: '', pendingApproval: false }) })
  assert.equal((await joinGroup(wpp, 'C')).ok, false)
})

// ===== 预览 =====

test('previewInvite 回填群主与成员数', async () => {
  const wpp = wppOf({
    getGroupInfoFromInviteCode: async () => ({
      id: 'g1@g.us', owner: 'owner@c.us', descOwner: 'd@c.us',
      participants: [{ id: 'a@c.us' }, { id: 'b@c.us' }]
    })
  })
  const r = await previewInvite(wpp, 'CODE')
  assert.equal(r.ok, true)
  assert.equal(r.owner, 'owner@c.us')
  assert.equal(r.participantCount, 2)
})

test('previewInvite 失败不抛', async () => {
  assert.equal((await previewInvite(undefined, 'C')).ok, false)
  const bad = wppOf({ getGroupInfoFromInviteCode: async () => { throw new Error('x') } })
  assert.equal((await previewInvite(bad, 'C')).ok, false)
})

// ===== B19 踢人：能力门是重点 =====

test('kickParticipants 全可踢→全进 removed', async () => {
  const wpp = wppOf({
      canRemove: async () => true,
      removeParticipants: async () => {}
  })
  const r = await kickParticipants(wpp, 'g1@g.us', ['a@c.us', 'b@c.us'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.removed, ['a@c.us', 'b@c.us'])
  assert.deepEqual(r.skipped, [])
})

test('kickParticipants canRemove=false 的必须 skipped、不能真踢（防踢超管）', async () => {
  const kicked: string[] = []
  const wpp = wppOf({
      // b@c.us 踢不了（超管），a@c.us 可以
      canRemove: async (_g, ids) => ids !== 'b@c.us',
      removeParticipants: async (_g, ids) => { kicked.push(String(ids)) }
  })
  const r = await kickParticipants(wpp, 'g1@g.us', ['a@c.us', 'b@c.us'])
  assert.deepEqual(r.removed, ['a@c.us'])
  assert.deepEqual(r.skipped, ['b@c.us'], '不可踢的必须单列 skipped')
  assert.deepEqual(kicked, ['a@c.us'], '**skipped 的那个绝不能真被踢**（不可逆）')
})

test('kickParticipants canRemove 抛异常→计 failed 且不踢（判不出就不做）', async () => {
  const kicked: string[] = []
  const wpp = wppOf({
      canRemove: async () => { throw new Error('judge boom') },
      removeParticipants: async (_g, ids) => { kicked.push(String(ids)) }
  })
  const r = await kickParticipants(wpp, 'g1@g.us', ['a@c.us'])
  assert.deepEqual(kicked, [], '校验抛异常＝判不出来，不可逆动作宁可不做')
  assert.equal(r.failed?.length, 1)
  assert.match(r.failed?.[0]?.error ?? '', /judge boom/)
})

test('kickParticipants removeParticipants 报错→计 failed 不影响其他人', async () => {
  const wpp = wppOf({
      canRemove: async () => true,
      removeParticipants: async (_g, ids) => {
        if (ids === 'b@c.us') throw new Error('nope')
      }
  })
  const r = await kickParticipants(wpp, 'g1@g.us', ['a@c.us', 'b@c.us'])
  assert.deepEqual(r.removed, ['a@c.us'])
  assert.equal(r.failed?.length, 1)
  assert.equal(r.failed?.[0]?.id, 'b@c.us')
})

test('kickParticipants 空名单/空群/能力缺失→不抛', async () => {
  const wpp = wppOf({ canRemove: async () => true, removeParticipants: async () => {} })
  const empty = await kickParticipants(wpp, 'g@g.us', [])
  assert.deepEqual(empty.removed, [])
  assert.equal((await kickParticipants(undefined, 'g', ['a'])).ok, false)
  assert.equal((await kickParticipants(wppOf({}), 'g', ['a'])).ok, false)
  assert.equal((await kickParticipants(wpp, '', ['a'])).ok, false)
})
