// src/bridge/whatsapp/send.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, receiptFrom, sendViaWa, toWaButtons } from './send.ts'
import type { ButtonSpec } from '../../shared/chatTypes.ts'

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

test('按钮素材：toWaButtons 把归一化按钮翻成 wa-js 形状（reply/url/call 区分字段）', () => {
  const buttons: ButtonSpec[] = [
    { type: 'reply', text: '咨询报价', value: 'quote' },
    { type: 'url', text: '官网', value: 'https://x.io' },
    { type: 'call', text: '来电', value: '+8613800000000' }
  ]
  assert.deepEqual(toWaButtons(buttons), [
    { id: 'quote', text: '咨询报价' },
    { url: 'https://x.io', text: '官网' },
    { phoneNumber: '+8613800000000', text: '来电' }
  ])
})

test('按钮素材：copy 在 wa-js 无原生对应，按 reply 兜底落到 id', () => {
  assert.deepEqual(toWaButtons([{ type: 'copy', text: '复制', value: 'CODE123' }]), [
    { id: 'CODE123', text: '复制' }
  ])
})

test('按钮素材：sendViaWa 把 buttons 透进 sendTextMessage 的 options', async () => {
  const calls: unknown[][] = []
  const chat = {
    async sendTextMessage(...args: unknown[]) {
      calls.push(args)
      return { id: 'true_861380001001@c.us_K-1_out', ack: 1, from: '861380000@c.us', sendMsgResult: 'OK' }
    }
  }
  const cmdWithButtons = {
    kind: 'send' as const,
    localId: 'L1',
    chatKey: '861380001001@c.us',
    text: '请选择',
    buttons: [{ type: 'reply' as const, text: '咨询报价', value: 'quote' }]
  }
  assert.deepEqual(await sendViaWa(cmdWithButtons, chat), {
    localId: 'L1',
    ok: true,
    msgKey: 'true_861380001001@c.us_K-1_out'
  })
  // options 末尾多了一个 buttons 数组（reply→{id,text}），其余两个开关不变。
  assert.deepEqual(calls[0], [
    '861380001001@c.us',
    '请选择',
    { createChat: true, waitForAck: false, buttons: [{ id: 'quote', text: '咨询报价' }] }
  ])
})
