// src/renderer/src/lib/createCustomerPrefill.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canCreateCustomer, prefillOfConversation, type PrefillSource } from './createCustomerPrefill.ts'

const src = (over: Partial<PrefillSource>): PrefillSource => ({
  chatKey: '8613800001001@c.us',
  title: 'Alice',
  platform: 'whatsapp',
  isGroup: false,
  customerId: null,
  ...over
})

test('陌生 WhatsApp 单聊：openId 就是 chatKey，手机号从形态里剥出来', () => {
  assert.equal(canCreateCustomer(src({})), true)
  assert.deepEqual(prefillOfConversation(src({})), {
    platformType: 1,
    openId: '8613800001001@c.us',
    nickname: 'Alice',
    phone: '8613800001001'
  })
})

test('三个否决各自单独成立：已关联、head 说是群、chatKey 是群形态', () => {
  assert.equal(canCreateCustomer(src({ customerId: 7 })), false)
  assert.equal(canCreateCustomer(src({ isGroup: true })), false)
  // head 标着"不是群"但键是 @g.us：两处都要过，只信 head 就会给群建出一位客户。
  assert.equal(canCreateCustomer(src({ chatKey: '120363000000000000@g.us' })), false)
  assert.equal(prefillOfConversation(src({ chatKey: '120363000000000000@g.us' })), null)
})

test('Telegram 单聊：没有电话号码形态，phone 留 null 而不是硬塞 chatKey', () => {
  const p = prefillOfConversation(src({ chatKey: '421933', platform: 'telegram' }))
  assert.deepEqual(p, { platformType: 4, openId: '421933', nickname: 'Alice', phone: null })
})

test('标题只有空白也不写空串：昵称留 null，列表页不会出现一个没有名字的客户', () => {
  assert.equal(prefillOfConversation(src({ title: '   ' }))?.nickname, null)
  assert.equal(prefillOfConversation(src({ title: null }))?.nickname, null)
  assert.equal(prefillOfConversation(src({ title: '  Bob  ' }))?.nickname, 'Bob')
})
