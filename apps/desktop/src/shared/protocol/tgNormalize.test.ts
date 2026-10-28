// src/shared/protocol/tgNormalize.test.ts
// TG 协议源（期一）：归一化分支与 chat_key 形态映射。
// 期一：契约层，未经真机验证——TG 的真实字段形状还没有账号可验证（spec §2.3 / R7）。
// 期二待办：拿到 api_id 与账号后，按实测回填 normalize.ts 的 tgMsgTypeToMediaType 取值域与时间戳字段。
// 契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInbound, tgMsgTypeToMediaType, wpMsgTypeToMediaType } from './normalize.ts'
import { inboundMessageToBatch, tgChatKeyOf } from './map.ts'
import type { IngestMessage, ProtocolInboundMessage } from './types.ts'

// 同一条消息的两种源形态：除 msgType 与 peerJid 外逐字段相同，用于证明 R5 同形。
const waInbound: ProtocolInboundMessage = {
  conversationId: 555,
  messageId: 9001,
  from: 0,
  peerJid: '8613800138000@c.us',
  senderJid: '8613800138000@c.us',
  senderName: '客户A',
  msgType: 2,
  content: { text: '你好', fileName: 'a.jpg' },
  waTimestamp: '1700000000',
  wpMsgId: 'WA_BLUE_123'
}

test('TG photo 与 WA 2 都归 image：是各走一张表的两个分支，不是改写同一张表', () => {
  assert.equal(tgMsgTypeToMediaType('photo'), 'image')
  assert.equal(wpMsgTypeToMediaType(2), 'image')
  // 交叉验证：TG 表认数字 2 无意义、WA 表认 'photo' 也无意义，两张表互不替代。
  assert.equal(tgMsgTypeToMediaType(2), 'text')
  assert.equal(wpMsgTypeToMediaType('photo'), 'text')
})

test('tgMsgTypeToMediaType：voice 归 audio、animation 归 video', () => {
  assert.equal(tgMsgTypeToMediaType('voice'), 'audio')
  assert.equal(tgMsgTypeToMediaType('animation'), 'video')
  assert.equal(tgMsgTypeToMediaType('video_note'), 'video')
})

test('tgMsgTypeToMediaType：未知 msgType（poll）与缺省都回落 text', () => {
  assert.equal(tgMsgTypeToMediaType('poll'), 'text')
  assert.equal(tgMsgTypeToMediaType(undefined), 'text')
  assert.equal(tgMsgTypeToMediaType(''), 'text')
})

test('normalizeInbound：protocolSource 缺省时按 WA 域解析——photo 不被 WA 表认出（WA 支未被污染的回归哨兵）', () => {
  assert.equal(normalizeInbound({ ...waInbound, msgType: 'photo' }).mediaType, 'text')
  assert.equal(
    normalizeInbound({ ...waInbound, msgType: 'photo' }, 'live', 'wa-protocol').mediaType,
    'text'
  )
  // 同一个 payload 走 telegram 分支才归 image。
  assert.equal(
    normalizeInbound({ ...waInbound, msgType: 'photo' }, 'live', 'telegram').mediaType,
    'image'
  )
})

test('tgChatKeyOf：超级群 -100 前缀负整数串原样落 chat_key', () => {
  assert.equal(tgChatKeyOf(-1001234567890), '-1001234567890')
  assert.equal(tgChatKeyOf('-1001234567890'), '-1001234567890')
})

test('tgChatKeyOf：单聊正整数串原样落 chat_key', () => {
  assert.equal(tgChatKeyOf('123456789'), '123456789')
  assert.equal(tgChatKeyOf(123456789), '123456789')
})

test('tgChatKeyOf：不接受 WA 的 xxx@c.us 形态（不把 TG id 编造成伪 JID）', () => {
  assert.equal(tgChatKeyOf('123@c.us'), null)
  assert.equal(tgChatKeyOf('123@g.us'), null)
})

test('tgChatKeyOf：非整数 / null / 空串 / 过短过长一律 null', () => {
  assert.equal(tgChatKeyOf('abc'), null)
  assert.equal(tgChatKeyOf(null), null)
  assert.equal(tgChatKeyOf(undefined), null)
  assert.equal(tgChatKeyOf(''), null)
  assert.equal(tgChatKeyOf('123'), null) // 去前导零后不足 4 位
  assert.equal(tgChatKeyOf('1'.repeat(21)), null) // 超过 20 位
})

test('R5：TG 入站经 inboundMessageToBatch 产出的 IngestMessage 与同形 WA 入站逐字段一致（除 mediaType）', () => {
  const wa = inboundMessageToBatch(7, waInbound)?.messages[0]
  const tg = inboundMessageToBatch(8, { ...waInbound, msgType: 'photo' }, 'telegram')?.messages[0]
  assert.ok(wa)
  assert.ok(tg)
  for (const key of Object.keys(wa) as Array<keyof IngestMessage>) {
    if (key === 'mediaType') continue
    assert.deepEqual(tg[key], wa[key], `字段 ${key} 在两个源之间必须同形`)
  }
  // 归一化收敛：WA 的 2 与 TG 的 photo 都落 image，主进程侧无需分支。
  assert.equal(wa.mediaType, 'image')
  assert.equal(tg.mediaType, 'image')
})

test('TG 入站的 chatKey 落在 TG 数字形态（tgChatKeyOf 认可）', () => {
  const tg = inboundMessageToBatch(
    8,
    { ...waInbound, peerJid: '-1001234567890', msgType: 'photo' },
    'telegram'
  )
  assert.ok(tg)
  assert.equal(tg.messages[0].chatKey, '-1001234567890')
  assert.equal(tgChatKeyOf(tg.messages[0].chatKey), '-1001234567890')
  assert.equal(tg.messages[0].mediaType, 'image')
  assert.equal(tg.messages[0].direction, 'in')
  assert.equal(tg.messages[0].status, 'received')
})
