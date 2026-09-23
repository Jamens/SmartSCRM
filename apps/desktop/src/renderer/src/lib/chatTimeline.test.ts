// src/renderer/src/lib/chatTimeline.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByConversation, type TimelineHead } from './chatTimeline.ts'

type Row = { accountId: number; chatKey: string; ts: number; id: number }

const msg = (chatKey: string, id: number, ts: number, accountId = 7): Row => ({ accountId, chatKey, ts, id })

const head = (chatKey: string, title: string | null, isGroup = false, accountId = 7): TimelineHead => ({
  accountId,
  chatKey,
  title,
  isGroup
})

test('两条会话交错输入：卡片按各卡最后一条倒序，组内按时间正序，一条不丢', () => {
  const input: Row[] = [
    msg('a@c.us', 1, 10),
    msg('b@c.us', 2, 50),
    msg('a@c.us', 3, 20),
    msg('b@c.us', 4, 30)
  ]
  const snapshot = input.map((r) => ({ ...r }))
  const out = groupByConversation(input, [head('a@c.us', 'Alice'), head('b@c.us', 'Bob')])
  assert.deepEqual(
    out.map((g) => [g.chatKey, g.lastTs, g.rows.map((r) => r.id)]),
    [
      ['b@c.us', 50, [4, 2]],
      ['a@c.us', 20, [1, 3]]
    ]
  )
  const total = out.reduce((n, g) => n + g.rows.length, 0)
  assert.equal(total, input.length)
  // 排序只许动组内的新数组：把 `messages.sort(...)` 写进来，记录页/时间线共用的一份行会被就地重排。
  assert.deepEqual(input, snapshot, '不许就地改调用方传进来的数组')
})

test('没有会话头的 chatKey 照样成组：标题回落到号码，群按形态判，一条都不许掉', () => {
  const out = groupByConversation([msg('120363000000000000@g.us', 1, 5), msg('86138@c.us', 2, 6)], [])
  assert.deepEqual(
    out.map((g) => [g.title, g.isGroup]),
    [
      ['86138', false],
      ['120363000000000000', true]
    ]
  )
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 2)
})

test('head 说不是群、键是 @g.us 形态：以形态为准', () => {
  const out = groupByConversation([msg('999@g.us', 1, 5)], [head('999@g.us', '项目组', false)])
  assert.equal(out[0].isGroup, true)
  // 标题仍取 head 给的（形态只影响"是不是群"这一项）。
  assert.equal(out[0].title, '项目组')
})

test('空输入给空数组；同一会话的消息被打乱也不会裂成两张卡', () => {
  assert.deepEqual(groupByConversation([], [head('a@c.us', 'A')]), [])
  const out = groupByConversation(
    [msg('a@c.us', 1, 30), msg('a@c.us', 2, 10), msg('a@c.us', 3, 20)],
    [head('a@c.us', 'A')]
  )
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].rows.map((r) => r.id), [2, 3, 1])
})

test('同一个号码挂在两个账号上：两张卡，各数各的消息，跳转键互不串', () => {
  const out = groupByConversation(
    [msg('a@c.us', 1, 10, 7), msg('a@c.us', 2, 20, 9), msg('a@c.us', 3, 30, 7)],
    [head('a@c.us', 'Alice（号 A）', false, 7), head('a@c.us', 'Alice（号 B）', false, 9)]
  )
  assert.deepEqual(
    out.map((g) => [g.accountId, g.title, g.rows.map((r) => r.id)]),
    [
      // 卡内最新：号 A 那条 30 > 号 B 的 20，所以号 A 在前。
      [7, 'Alice（号 A）', [1, 3]],
      [9, 'Alice（号 B）', [2]]
    ]
  )
  // 只有"两张卡 + 每条消息都在自己账号那张里"才挡得住按 chatKey 归并的实现：
  // 那种写法这里会给出 1 张卡、3 行，而页面上看着只是"少了一张卡"，谁都不会去数。
  assert.equal(out.length, 2)
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 3)
  assert.equal(new Set(out.map((g) => `${g.accountId}|${g.chatKey}`)).size, 2)
})

test('两个账号里只有一条有会话头：另一张走回落组，照样不许把消息并过去', () => {
  const out = groupByConversation([msg('a@c.us', 1, 10, 7), msg('a@c.us', 2, 20, 9)], [head('a@c.us', 'Alice', false, 7)])
  assert.deepEqual(
    out.map((g) => [g.accountId, g.title, g.rows.length]),
    [
      [9, 'a', 1],
      [7, 'Alice', 1]
    ]
  )
})
