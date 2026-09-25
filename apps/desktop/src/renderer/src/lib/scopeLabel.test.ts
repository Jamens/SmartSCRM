// src/renderer/src/lib/scopeLabel.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  conversationRefOf,
  customerRefOf,
  GLOBAL_REF,
  refOfScope,
  scopeBadgeOf,
  settingsKeyOf,
  settingsParamsOf,
  settingsScopeOf
} from './scopeLabel.ts'

const CONV = conversationRefOf(5, '8613814968550@c.us')
const CUST = customerRefOf(7)

test('全局档的缓存键只有档位那一格', () => {
  assert.deepEqual(settingsKeyOf(GLOBAL_REF), ['translation-settings', 'global'])
})

test('客户档的缓存键带**数字** id，不是字符串', () => {
  assert.deepEqual(settingsKeyOf(CUST), ['translation-settings', 'customer', 7])
})

test('会话档的缓存键是四段：chatKey 整段作第三段，没有任何一格是拼好的键串', () => {
  const key = settingsKeyOf(CONV)
  assert.deepEqual(key, ['translation-settings', 'conversation', 5, '8613814968550@c.us'])
  // 前端一旦自己拼出 `5:8613…@c.us`，就会有一格含冒号——那正是 spec §3.4 禁止的事。
  assert.equal(
    key.some((seg) => String(seg).includes(':')),
    false
  )
})

test('同一个 chatKey 在两个账号下是两条缓存（不串档）', () => {
  assert.notDeepEqual(
    settingsKeyOf(CONV),
    settingsKeyOf(conversationRefOf(6, '8613814968550@c.us'))
  )
})

test('GET：全局档不带参数', () => {
  assert.equal(settingsParamsOf(GLOBAL_REF), '')
})

test('GET：客户档只带 customerId', () => {
  assert.equal(settingsParamsOf(CUST), 'customerId=7')
})

test('GET：会话档带 accountId + chatKey，且**不带** customerId（缓存键里没有它，就不能让它影响请求）', () => {
  assert.equal(settingsParamsOf(CONV), 'accountId=5&chatKey=8613814968550%40c.us')
  assert.equal(settingsParamsOf(CONV).includes('customerId'), false)
})

test('GET：chatKey 按 query 编码，群键里的 `-` 与 `@g.us` 也不会漏成两个参数', () => {
  assert.equal(
    settingsParamsOf(conversationRefOf(5, '120363000000000000@g.us')),
    'accountId=5&chatKey=120363000000000000%40g.us'
  )
  assert.equal(
    settingsParamsOf(conversationRefOf(5, 'a b@c.us')),
    'accountId=5&chatKey=a%20b%40c.us'
  )
})

test('PUT：会话档交 accountId + chatKey 两个字段，没有 scopeKey（spec §3.4）', () => {
  assert.deepEqual(Object.keys(settingsScopeOf(CONV)).sort(), ['accountId', 'chatKey', 'scope'])
  assert.deepEqual(settingsScopeOf(CONV), {
    scope: 'conversation',
    accountId: 5,
    chatKey: '8613814968550@c.us'
  })
})

test('PUT：客户档交 scopeKey，没有 accountId / chatKey', () => {
  assert.deepEqual(settingsScopeOf(CUST), { scope: 'customer', scopeKey: '7' })
})

test('PUT：全局档只有 scope', () => {
  assert.deepEqual(settingsScopeOf(GLOBAL_REF), { scope: 'global' })
})

test('徽标三态：本会话专属 / 该客户专属 / 沿用全局', () => {
  assert.equal(scopeBadgeOf('conversation'), '本会话专属')
  assert.equal(scopeBadgeOf('customer'), '该客户专属')
  assert.equal(scopeBadgeOf('global'), '沿用全局')
})

test('认不出的档位不猜名字（猜错就是屏幕上摆一句假话）', () => {
  assert.equal(scopeBadgeOf(''), '生效档未识别')
  assert.equal(scopeBadgeOf('tenant'), '生效档未识别')
})

test('写回层：生效档是全局就写全局，哪怕手里握着客户 ref', () => {
  assert.deepEqual(refOfScope('global', { conversation: CONV, customer: CUST }), GLOBAL_REF)
})

test('写回层：生效档是会话且调用方握着会话 ref → 就是它', () => {
  assert.deepEqual(refOfScope('conversation', { conversation: CONV, customer: CUST }), CONV)
})

test('写回层：生效档是客户时只认客户 ref，会话 ref 不算数', () => {
  assert.deepEqual(refOfScope('customer', { conversation: CONV, customer: CUST }), CUST)
})

test('写回层：定位不到那一档时回 null，绝不退回别的档', () => {
  assert.equal(refOfScope('conversation', { customer: CUST }), null)
  assert.equal(refOfScope('customer', { conversation: CONV }), null)
  assert.equal(refOfScope('customer', {}), null)
  assert.equal(refOfScope('未识别', { conversation: CONV, customer: CUST }), null)
})

test('写回层：客户 ref 可以是 null（陌生会话没有 customerId），此时客户档定位不到', () => {
  assert.equal(refOfScope('customer', { conversation: CONV, customer: null }), null)
})
