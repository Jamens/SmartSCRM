// src/shared/chatStatus.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WA_ACK, canAdvance, fromAck, rankOf } from './chatStatus.ts'

test('发出消息的 ack → 状态词；缺省与未知值落 pending，不猜成功', () => {
  assert.equal(fromAck(WA_ACK.SENT, 'out'), 'sent')
  assert.equal(fromAck(WA_ACK.DELIVERED, 'out'), 'delivered')
  assert.equal(fromAck(WA_ACK.READ, 'out'), 'read')
  assert.equal(fromAck(WA_ACK.PLAYED, 'out'), 'read')
  assert.equal(fromAck(WA_ACK.FAILED, 'out'), 'failed')
  assert.equal(fromAck(WA_ACK.PENDING, 'out'), 'pending')
  assert.equal(fromAck(undefined, 'out'), 'pending')
  assert.equal(fromAck(99, 'out'), 'pending')
})

test('接收方向不看 ack：收到就是 received', () => {
  for (const ack of [undefined, 0, 1, 3, -1, 99]) assert.equal(fromAck(ack, 'in'), 'received')
})

test('canAdvance 与后端 SQL 守卫同形（这六条是 Task 3 契约探针的镜像）', () => {
  assert.equal(canAdvance('sent', 'delivered'), true)
  assert.equal(canAdvance('delivered', 'sent'), false)
  assert.equal(canAdvance('delivered', 'delivered'), false)
  assert.equal(canAdvance('read', 'failed'), false)
  assert.equal(canAdvance('pending', 'failed'), true)
  assert.equal(canAdvance('sent', 'failed'), true)
  assert.equal(canAdvance('failed', 'sent'), false)
  // in 的 received 不在阶梯上：它永远不接受后续推进。
  assert.equal(canAdvance('received', 'sent'), false)
  assert.equal(canAdvance('bogus', 'read'), false)
})

test('rankOf：阶梯外一律 -1，阶梯内单调', () => {
  assert.deepEqual(
    ['pending', 'sent', 'delivered', 'read'].map(rankOf),
    [0, 1, 2, 3]
  )
  assert.equal(rankOf('received'), -1)
  assert.equal(rankOf('failed'), -1)
  assert.equal(rankOf(''), -1)
})
