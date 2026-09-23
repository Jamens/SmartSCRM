// src/shared/chatKeys.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGroupChatKey, peerPhoneOfChatKey } from './chatKeys.ts'

test('群判定只看形态：WA 的 @g.us 与 TG 的 -100 / @group', () => {
  assert.equal(isGroupChatKey('8613800001001@c.us'), false)
  assert.equal(isGroupChatKey('120363000000000000@g.us'), true)
  // 带连字符的 WhatsApp 群 id（V8 的列注释里就是这个例子）
  assert.equal(isGroupChatKey('1234567890-1234567890@g.us'), true)
  assert.equal(isGroupChatKey('-1001234567890'), true)
  assert.equal(isGroupChatKey('1234567890@group'), true)
  assert.equal(isGroupChatKey('421933'), false)
})

test('空与 null 都不算群：拼合成行时拿到 undefined 不能抛', () => {
  assert.equal(isGroupChatKey(''), false)
  assert.equal(isGroupChatKey(null), false)
  assert.equal(isGroupChatKey(undefined), false)
})

test('裸号码只对 WhatsApp 单聊成立', () => {
  assert.equal(peerPhoneOfChatKey('8613800001001@c.us'), '8613800001001')
  // `.lid` 与 `s.wallet` 也是 WA 单聊形态：后端 WA_PEER 就是这三个后缀
  assert.equal(peerPhoneOfChatKey('12345678@lid'), '12345678')
  assert.equal(peerPhoneOfChatKey('8613800001001@c.usx'), null)
  assert.equal(peerPhoneOfChatKey('120363000000000000@g.us'), null)
  assert.equal(peerPhoneOfChatKey('-1001234567890'), null)
})

test('号码长度边界与后端同一条正则：5..20 位，短一号就不是号码', () => {
  assert.equal(peerPhoneOfChatKey('1234@c.us'), null)
  assert.equal(peerPhoneOfChatKey('12345@c.us'), '12345')
  assert.equal(peerPhoneOfChatKey('1'.repeat(21) + '@c.us'), null)
})
