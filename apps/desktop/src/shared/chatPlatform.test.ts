// src/shared/chatPlatform.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountTypeOfPlatform, isChatPlatform, platformOfAccountType } from './chatPlatform.ts'

test('platform_type 1 / 4 才是 P6 的支持面，其它一律 null', () => {
  assert.equal(platformOfAccountType(1), 'whatsapp')
  assert.equal(platformOfAccountType(4), 'telegram')
  // 2/3/5/6/7 在既有 PlatformType 里是真实存在的平台：它们必须落到 null，
  // 而不是被当成 whatsapp —— 否则内嵌一个没有桥的平台会静默丢数据。
  for (const t of [0, 2, 3, 5, 6, 7, 1.5, Number.NaN]) assert.equal(platformOfAccountType(t), null)
  for (const t of [undefined, null]) assert.equal(platformOfAccountType(t), null)
})

test('双向映射互逆', () => {
  const wa = platformOfAccountType(1)
  const tg = platformOfAccountType(4)
  assert.equal(wa && accountTypeOfPlatform(wa), 1)
  assert.equal(tg && accountTypeOfPlatform(tg), 4)
})

test('列值是小写字面量：`WhatsApp` / `TELEGRAM` 都不是合法 platform', () => {
  assert.equal(isChatPlatform('whatsapp'), true)
  assert.equal(isChatPlatform('telegram'), true)
  assert.equal(isChatPlatform('WhatsApp'), false)
  assert.equal(isChatPlatform(''), false)
  assert.equal(isChatPlatform(undefined), false)
})
