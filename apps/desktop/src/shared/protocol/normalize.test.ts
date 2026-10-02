// src/shared/protocol/normalize.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeInbound,
  normalizeInboundBatch,
  normalizeStatusPush,
  toEpochSec,
  wpStatusToMsgStatus
} from './normalize.ts'
import type { ProtocolInboundMessage } from './types.ts'

const inbound: ProtocolInboundMessage = {
  conversationId: 555,
  messageId: 9001,
  from: 0,
  peerJid: '8613800138000@c.us',
  senderJid: '8613800138000@c.us',
  senderName: '客户A',
  msgType: 1,
  content: { text: '你好' },
  waTimestamp: '1700000000',
  wpMsgId: 'WA_BLUE_123'
}

test('normalizeInbound：入站（from=0）方向 in、状态 received、chatKey 取 peerJid、msgKey 取 messageId', () => {
  const m = normalizeInbound(inbound)
  assert.equal(m.direction, 'in')
  assert.equal(m.status, 'received')
  assert.equal(m.chatKey, '8613800138000@c.us')
  assert.equal(m.msgKey, '9001')
  assert.equal(m.msgId, 'WA_BLUE_123')
  assert.equal(m.body, '你好')
  assert.equal(m.mediaType, 'text')
  assert.equal(m.msgTimeEpochSec, 1_700_000_000)
  assert.equal(m.source, 'live')
})

test('normalizeInbound：出站（from=1）方向 out、状态按网关值、带 sendLocalId', () => {
  const m = normalizeInbound({ ...inbound, from: 1, status: 3, clientMsgId: 'local-9' })
  assert.equal(m.direction, 'out')
  assert.equal(m.status, 'delivered')
  assert.equal(m.sendLocalId, 'local-9')
  assert.equal(m.body, '你好')
})

test('normalizeInbound：mediaType 由 msgType 映射，文本/缺省兜底 text', () => {
  assert.equal(normalizeInbound({ ...inbound, msgType: 2 }).mediaType, 'image')
  assert.equal(normalizeInbound({ ...inbound, msgType: 5 }).mediaType, 'document')
  assert.equal(normalizeInbound({ ...inbound, msgType: 99 }).mediaType, 'unknown')
  assert.equal(normalizeInbound({ ...inbound, msgType: undefined }).mediaType, 'text')
})

test('wpStatusToMsgStatus：0-6 码与枚举名都识别，Revoked 归 failed，空值 undef', () => {
  assert.equal(wpStatusToMsgStatus(0), 'pending')
  assert.equal(wpStatusToMsgStatus(2), 'sent')
  assert.equal(wpStatusToMsgStatus(4), 'read')
  assert.equal(wpStatusToMsgStatus(5), 'failed')
  assert.equal(wpStatusToMsgStatus(6), 'failed')
  assert.equal(wpStatusToMsgStatus('SENT'), 'sent')
  assert.equal(wpStatusToMsgStatus('REVOKED'), 'failed')
  assert.equal(wpStatusToMsgStatus(null), undefined)
  assert.equal(wpStatusToMsgStatus(''), undefined)
})

test('toEpochSec：epoch 秒串 / ISO / 数字 都能换算，缺省回退数字', () => {
  assert.equal(toEpochSec('1700000000'), 1_700_000_000)
  assert.equal(typeof toEpochSec(null), 'number')
  assert.ok(toEpochSec(null) > 1_700_000_000)
})

test('normalizeStatusPush：抽出 status 更新数组并带 accountId', () => {
  const s = normalizeStatusPush(
    '8613800138000@c.us',
    [
      { msgKey: 'k1', status: 'read' },
      { msgKey: 'k2', status: 'delivered' }
    ],
    7
  )
  assert.equal(s.accountId, 7)
  assert.equal(s.chatKey, '8613800138000@c.us')
  assert.deepEqual(s.updates, [
    { msgKey: 'k1', status: 'read' },
    { msgKey: 'k2', status: 'delivered' }
  ])
})

test('normalizeInboundBatch：整段历史映射，source 默认 backfill', () => {
  const out = normalizeInboundBatch([inbound, { ...inbound, messageId: 9002 }])
  assert.equal(out.length, 2)
  assert.equal(out[0].source, 'backfill')
})
