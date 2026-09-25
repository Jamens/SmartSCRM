// src/shared/chatKeys.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeChatKeyOf, CHAT_KEY_MAX, isGroupChatKey, peerPhoneOfChatKey } from './chatKeys.ts'

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

test('活动会话裁剪：三种真实形态原样返回，不裁内容', () => {
  assert.equal(activeChatKeyOf('8613800001001@c.us'), '8613800001001@c.us')
  assert.equal(activeChatKeyOf('120363000000000000@g.us'), '120363000000000000@g.us')
  // Telegram 的会话 id 是纯数字（Task 12a 未做，但裁剪函数不该按平台分家）
  assert.equal(activeChatKeyOf('-1001234567890'), '-1001234567890')
})

test('null 与 undefined → null：桥还没报过活动会话是正常状态', () => {
  assert.equal(activeChatKeyOf(null), null)
  assert.equal(activeChatKeyOf(undefined), null)
})

test('空串 → null（不是"合法的 0 长度会话"）', () => {
  assert.equal(activeChatKeyOf(''), null)
})

test('纯空白 → null：空格 tab 都是不成形', () => {
  assert.equal(activeChatKeyOf('   '), null)
  assert.equal(activeChatKeyOf('\t'), null)
})

test('含换行或内部空白 → null：页内字段带进主进程的东西不能有两段', () => {
  assert.equal(activeChatKeyOf('8613@c.us\n'), null)
  assert.equal(activeChatKeyOf('a\nb'), null)
  assert.equal(activeChatKeyOf('8613 @c.us'), null)
})

test('128 字符通过：与后端 chat_conversation.chat_key 同宽', () => {
  const key = 'x'.repeat(128)
  assert.equal(activeChatKeyOf(key), key)
})

test('129 字符 → null：超长只可能是坏上报，裁掉比带给后端 400 好', () => {
  assert.equal(activeChatKeyOf('x'.repeat(129)), null)
})

test('控制符 → null：与 Java 的 [\\p{Cntrl}\\s] 同一批字符', () => {
  // 三行分别喂 0x00 / 0x1F / 0x7F（用 String.fromCharCode 而不是 `\u0000` 转义：
  // 断言的是同一批字符，写法上不依赖源码里的转义能不能落地）。
  assert.equal(activeChatKeyOf('a' + String.fromCharCode(0) + 'b'), null)
  assert.equal(activeChatKeyOf('a' + String.fromCharCode(0x1f) + 'b'), null)
  assert.equal(activeChatKeyOf('a' + String.fromCharCode(0x7f) + 'b'), null)
})

test('不 trim、不折叠大小写：平台 id 大小写敏感，这里 normalize 一次就和入库键差一个字符', () => {
  assert.equal(activeChatKeyOf(' 8613@c.us'), null) // 前置空格属于"含空白"，不是"trim 后能用"
  assert.equal(activeChatKeyOf('AA@C.US'), 'AA@C.US')
  assert.equal(CHAT_KEY_MAX, 128) // 与 ConversationScopeKey.CHAT_KEY_MAX 同数：改这边要同步改那边
})
