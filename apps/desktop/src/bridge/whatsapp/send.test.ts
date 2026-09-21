// src/bridge/whatsapp/send.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, receiptFrom, sendViaWa } from './send.ts'

const cmd = { kind: 'send' as const, localId: 'L1', chatKey: '861380001001@c.us', text: 'hi' }

test('发送成功：回执带 msgKey（真机返回的是字符串 id，不是 MsgKey 实例）', async () => {
  const calls: unknown[][] = []
  const chat = {
    async sendTextMessage(...args: unknown[]) {
      calls.push(args)
      return {
        id: 'true_861380001001@c.us_K-1_out',
        ack: 1,
        from: '861380000@c.us',
        to: '861380001001@c.us',
        sendMsgResult: 'OK'
      }
    }
  }
  assert.deepEqual(await sendViaWa(cmd, chat), { localId: 'L1', ok: true, msgKey: 'true_861380001001@c.us_K-1_out' })
  assert.deepEqual(calls[0], ['861380001001@c.us', 'hi', { createChat: true, waitForAck: false }])
})

test('桥在但 WPP 没就绪：BRIDGE_OFFLINE，不发就不算失败在平台上', async () => {
  assert.deepEqual(await sendViaWa(cmd, undefined), {
    localId: 'L1',
    ok: false,
    error: 'BRIDGE_OFFLINE',
    detail: 'WPP.chat 不可用'
  })
})

test('取不到 id 时按失败处理，不留无法关联的成功', () => {
  assert.equal(receiptFrom(cmd, {}, null)?.error, 'SEND_FAILED')
  assert.equal(receiptFrom(cmd, { id: '' }, null)?.error, 'SEND_FAILED')
  assert.equal(receiptFrom(cmd, undefined, null).ok, false)
})

test('错误分类：认得出的算 CHAT_NOT_FOUND，认不出的算 SEND_FAILED', () => {
  assert.equal(classify(new Error('Unable to find chat')), 'CHAT_NOT_FOUND')
  assert.equal(classify(new Error('Server error 500')), 'SEND_FAILED')
})
