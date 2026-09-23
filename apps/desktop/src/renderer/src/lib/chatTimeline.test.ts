// src/renderer/src/lib/chatTimeline.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByConversation, type TimelineHead } from './chatTimeline.ts'

const msg = (chatKey: string, id: number, ts: number): { chatKey: string; ts: number; id: number } => ({
  chatKey,
  ts,
  id
})

const head = (chatKey: string, title: string | null, isGroup = false): TimelineHead => ({
  chatKey,
  title,
  isGroup
})

test('两条会话交错输入：卡片按各卡最后一条倒序，组内按时间正序，一条不丢', () => {
  const input = [
    msg('a@c.us', 1, 10),
    msg('b@c.us', 2, 50),
    msg('a@c.us', 3, 20),
    msg('b@c.us', 4, 30)
  ]
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
  const out = groupByConversation([msg('a@c.us', 1, 30), msg('a@c.us', 2, 10), msg('a@c.us', 3, 20)], [head('a@c.us', 'A')])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].rows.map((r) => r.id), [2, 3, 1])
})
