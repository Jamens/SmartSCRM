// src/renderer/src/lib/chatSearch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorLabel, HIGHLIGHT_MS, jumpToOfHit, type HitShape } from './chatSearch.ts'

const local = (y: number, m: number, d: number, hh = 10, mm = 30): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

/** 后端发的是本地墙钟串（收敛 9），渲染层一律按本地时区解释——这里同法造数据。 */
const wall = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const base = (): HitShape['message'] => ({
  id: 77,
  accountId: 3,
  platform: 'whatsapp',
  chatKey: '8613800001001@c.us',
  msgKey: 'false_8613800001001@c.us_ABC',
  msgTime: wall(local(2026, 9, 20)),
  customerId: 12
})

const hit = (over: Partial<HitShape> = {}): HitShape => ({
  message: base(),
  conversationId: 41,
  chatTitle: 'Ana',
  ...over
})

test('正常命中：会话行由命中消息 + 会话头拼出来，字段一项都不许错位', () => {
  const t = jumpToOfHit(hit())
  assert.ok(t)
  assert.equal(t.conversation.id, 41)
  assert.equal(t.conversation.accountId, 3)
  assert.equal(t.conversation.chatKey, '8613800001001@c.us')
  assert.equal(t.conversation.title, 'Ana')
  assert.equal(t.conversation.isGroup, false)
  assert.equal(t.conversation.customerId, 12)
  // 合成行不谎报未读：未读由跳转时显式 markRead 去清，角标靠列表 refetch 抹平
  assert.equal(t.conversation.unreadCount, 0)
  assert.equal(t.anchor.messageId, 77)
  assert.equal(t.anchor.msgKey, 'false_8613800001001@c.us_ABC')
  assert.equal(t.anchor.chatKey, '8613800001001@c.us')
})

test('群命中：isGroup 从 chat_key 形态来，不从标题猜', () => {
  const t = jumpToOfHit(hit({ message: { ...base(), chatKey: '1234567890-1234@g.us' }, chatTitle: null }))
  assert.ok(t)
  assert.equal(t.conversation.isGroup, true)
  assert.equal(t.conversation.title, null)
})

test('会话头缺失时不跳：卡片 disabled 比"跳过去啥也没定位到"好解释', () => {
  assert.equal(jumpToOfHit(hit({ conversationId: null })), null)
})

test('定位条文案：今年省年份、跨年补年份；高亮停留 2 秒', () => {
  const now = local(2026, 9, 20, 23, 0)
  assert.equal(anchorLabel(local(2026, 9, 12, 8, 5), now), '9月12日 08:05')
  assert.equal(anchorLabel(local(2025, 12, 31, 23, 59), now), '2025年12月31日 23:59')
  assert.equal(HIGHLIGHT_MS, 2_000)
})
