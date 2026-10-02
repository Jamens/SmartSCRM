// src/shared/protocol/map.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inboundMessageToBatch,
  statusPushToStatus,
  protocolSendMsgKey,
  runProtocolSend,
  type ProtocolSendResponse
} from './map.ts'
import type { ProtocolInboundMessage, ProtocolStatusPush } from './types.ts'

const msg: ProtocolInboundMessage = {
  conversationId: 555,
  messageId: 9001,
  from: 0,
  peerJid: '8613800138000@c.us',
  content: { text: 'hi' }
}
const CHAT_KEY = '8613800138000@c.us'

test('inboundMessageToBatch：正常 payload 映射为单条 live 入库批量', () => {
  const batch = inboundMessageToBatch(7, msg)
  assert.ok(batch)
  assert.equal(batch.accountId, 7)
  assert.equal(batch.activeChatKey, null)
  assert.equal(batch.messages.length, 1)
  assert.equal(batch.messages[0].direction, 'in')
  assert.equal(batch.messages[0].status, 'received')
  assert.equal(batch.messages[0].source, 'live')
  assert.equal(batch.messages[0].chatKey, CHAT_KEY)
  assert.equal(batch.messages[0].msgKey, '9001')
})

test('inboundMessageToBatch：缺 peerJid 且无 conversationId 时返回 null', () => {
  assert.equal(inboundMessageToBatch(7, {}), null)
  assert.equal(inboundMessageToBatch(7, undefined), null)
})

test('statusPushToStatus：正常 payload 映射为状态批量（msgKey 取 messageId）', () => {
  const push: ProtocolStatusPush = { conversationId: 555, messageId: 9001, status: 4 }
  const status = statusPushToStatus(7, CHAT_KEY, push)
  assert.ok(status)
  assert.equal(status.accountId, 7)
  assert.equal(status.chatKey, CHAT_KEY)
  assert.deepEqual(status.updates, [{ msgKey: '9001', status: 'read' }])
})

test('statusPushToStatus：缺 messageId 或无 chatKey 时返回 null', () => {
  assert.equal(statusPushToStatus(7, CHAT_KEY, { conversationId: 555 }), null)
  assert.equal(statusPushToStatus(7, '', { conversationId: 555, messageId: 1 }), null)
})

// ---------------------------------------------------------------------------
// 出站发送（B27 出站腿）
// ---------------------------------------------------------------------------

test('protocolSendMsgKey：优先 messageId，与入站 normalizeInbound 同优先级', () => {
  assert.equal(protocolSendMsgKey({ messageId: 777 }, 'fallback-cid'), '777')
})

test('protocolSendMsgKey：messageId 缺失时退回 wpMsgId', () => {
  assert.equal(protocolSendMsgKey({ wpMsgId: 'wa-abc' }, 'fallback-cid'), 'wa-abc')
})

test('protocolSendMsgKey：两者皆无时退回 clientMsgId 兜底', () => {
  assert.equal(protocolSendMsgKey({}, 'fallback-cid'), 'fallback-cid')
  assert.equal(protocolSendMsgKey(null, 'fallback-cid'), 'fallback-cid')
})

test('runProtocolSend：成功路径返回 ok + 与入站同键的 msgKey', async () => {
  const sendFn = async (): Promise<ProtocolSendResponse> => ({ messageId: 777 })
  const r = await runProtocolSend(
    { accountId: 7, chatKey: CHAT_KEY, text: 'hi', clientMsgId: 'cid-1' },
    sendFn
  )
  assert.deepEqual(r, { localId: '', ok: true, msgKey: '777' })
})

test('runProtocolSend：网关未返回结果按 SEND_FAILED 结清', async () => {
  const sendFn = async (): Promise<null> => null
  const r = await runProtocolSend(
    { accountId: 7, chatKey: CHAT_KEY, text: 'hi', clientMsgId: 'cid-1' },
    sendFn
  )
  assert.equal(r.ok, false)
  assert.equal(r.error, 'SEND_FAILED')
})

test('runProtocolSend：sendFn 抛错被捕获为 SEND_FAILED（不泄露 reject）', async () => {
  const sendFn = async (): Promise<never> => {
    throw new Error('network down')
  }
  const r = await runProtocolSend(
    { accountId: 7, chatKey: CHAT_KEY, text: 'hi', clientMsgId: 'cid-1' },
    sendFn
  )
  assert.equal(r.ok, false)
  assert.equal(r.error, 'SEND_FAILED')
  assert.equal(r.detail, 'network down')
})
