// src/shared/chatPlatform.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountTypeOfPlatform, isChatPlatform, platformOfAccountType } from './chatPlatform.ts'

test('platform_type 1 / 4 / 7 在支持面内，2/3/5/6 仍落 null', () => {
  assert.equal(platformOfAccountType(1), 'whatsapp')
  assert.equal(platformOfAccountType(4), 'telegram')
  // 协议号(7) 与 WA 同形态、走外部 protocol 服务，复用 'whatsapp' 入库面（B27 入站腿）。
  assert.equal(platformOfAccountType(7), 'whatsapp')
  // 2/3/5/6 在 PlatformType 里是真实平台，但本期无页内桥/无传输层，必须落 null 而非被当 whatsapp，
  // 否则会内嵌一个没有桥的平台静默丢数据。
  for (const t of [0, 2, 3, 5, 6, 1.5, Number.NaN]) assert.equal(platformOfAccountType(t), null)
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
