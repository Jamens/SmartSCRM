// src/shared/msgIds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MSG_ID_MAX, msgIdOfSerializedKey, platformMsgIdOf } from './msgIds.ts'

/**
 * 这批字面量同时是后端 `TranslationService.platformMsgId` 的判据：两边喂同一批输入，结果必须一致。
 * 这里守 JS 这一半；Java 那一半没有同名单测，它由后端 HTTP 契约驱动 `tmp/p7f-translate-contract.mjs`
 * 的 D 组（通配/空白/转义 msgId 被拦、请求照常走引擎、无行被命中）在验收时守——`tmp/` 不入 commit。
 */
const WA_MSG_ID = '0FEA11D8A2B3C4D5E6F7A8B9C0D1E2F3'

test('平台实形通过且原样返回：不 trim、不改大小写', () => {
  assert.equal(platformMsgIdOf(WA_MSG_ID), WA_MSG_ID)
  assert.equal(platformMsgIdOf('abc123'), 'abc123')
})

test('空 / null / undefined → null：空串会让后端的 LIKE 放大成该会话每一行', () => {
  assert.equal(platformMsgIdOf(''), null)
  assert.equal(platformMsgIdOf(null), null)
  assert.equal(platformMsgIdOf(undefined), null)
})

test('全空白 → null：可见 ASCII 那道就把空格(0x20)挡了', () => {
  assert.equal(platformMsgIdOf('   '), null)
  assert.equal(platformMsgIdOf('\t'), null)
})

test('LIKE 通配符与转义符 → null：它们会把"这一条"变成"任意一条"', () => {
  assert.equal(platformMsgIdOf('%'), null)
  assert.equal(platformMsgIdOf('_'), null)
  assert.equal(platformMsgIdOf('\\'), null)
  assert.equal(platformMsgIdOf('a%b'), null)
  assert.equal(platformMsgIdOf('a_b'), null)
  assert.equal(platformMsgIdOf('a\\b'), null)
})

test('内部空白与控制符 → null：实形是连续 token，带这些的必然是别的东西', () => {
  assert.equal(platformMsgIdOf('a b'), null)
  assert.equal(platformMsgIdOf('a\nb'), null)
  // 0x00 与 0x1F 在可见区间之下，0x7F 在其上（用 fromCharCode 而不是转义写法）
  assert.equal(platformMsgIdOf('a' + String.fromCharCode(0) + 'b'), null)
  assert.equal(platformMsgIdOf('a' + String.fromCharCode(0x1f) + 'b'), null)
  assert.equal(platformMsgIdOf('a' + String.fromCharCode(0x7f) + 'b'), null)
})

test('非 ASCII → null：页内正文混进 id 字段的那一类', () => {
  assert.equal(platformMsgIdOf('中文'), null)
  assert.equal(platformMsgIdOf('id\u00e9'), null)
})

test(`${MSG_ID_MAX} 字符通过、${MSG_ID_MAX + 1} 字符 → null：与 msg_id 列宽同数`, () => {
  assert.equal(platformMsgIdOf('x'.repeat(MSG_ID_MAX)), 'x'.repeat(MSG_ID_MAX))
  assert.equal(platformMsgIdOf('x'.repeat(MSG_ID_MAX + 1)), null)
})

test('可见 ASCII 的两端：0x21 与 0x7E 各算一个合格字符，0x20 与 0x7F 不算', () => {
  const at = (code: number): string => 'a' + String.fromCharCode(code) + 'b'
  assert.equal(platformMsgIdOf(at(0x21)), at(0x21))
  assert.equal(platformMsgIdOf(at(0x7e)), at(0x7e))
  assert.equal(platformMsgIdOf(at(0x20)), null)
  assert.equal(platformMsgIdOf(at(0x7f)), null)
})

// —— 从序列化的 msgKey 反取裸 id：send_result 补写那一行唯一的裸 id 来源 ——

test('发出行的键去掉 _out 尾再取末段：形状与 normalize.test.ts 钉的那条一致', () => {
  assert.equal(msgIdOfSerializedKey('true_261963795943523@lid_ACBEDD_out'), 'ACBEDD')
})

test('收到行的键没有 _out 尾，末段就是裸 id', () => {
  assert.equal(msgIdOfSerializedKey('false_261963795943523@lid_ACBEDD'), 'ACBEDD')
})

test('非 WA 形状（没有 true_/false_ 前缀）→ null：不许按 _ 切一刀造出假 id', () => {
  assert.equal(msgIdOfSerializedKey('tg_msg_12345'), null)
  assert.equal(msgIdOfSerializedKey(''), null)
  assert.equal(msgIdOfSerializedKey(null), null)
  assert.equal(msgIdOfSerializedKey(undefined), null)
})

test('末段过不了形状闸的键 → null：带通配符/空白/超长的都不当裸 id', () => {
  assert.equal(msgIdOfSerializedKey('true_1@c.us_a%b'), null)
  assert.equal(msgIdOfSerializedKey('true_1@c.us_'), null)
  assert.equal(msgIdOfSerializedKey('true_1@c.us_' + 'x'.repeat(MSG_ID_MAX + 1)), null)
})
