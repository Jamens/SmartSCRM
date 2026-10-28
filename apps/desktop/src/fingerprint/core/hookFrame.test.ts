// src/fingerprint/core/hookFrame.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installHook, isOurs, markOurs } from './hookFrame.ts'

test('装得上：返回 true，且属性被覆盖', () => {
  const target: Record<string, unknown> = { platform: 'RealPlatform' }
  const ok = installHook(
    target,
    'platform',
    () => 'FakePlatform',
    () => 0.5
  )
  assert.equal(ok, true)
  assert.equal(target.platform, 'FakePlatform')
})

test('属性不可配置：返回 false、不抛、原值不动（一个属性装不上不能连累其它项）', () => {
  const target: Record<string, unknown> = {}
  Object.defineProperty(target, 'platform', { value: 'RealPlatform', configurable: false })
  const ok = installHook(
    target,
    'platform',
    () => 'FakePlatform',
    () => 0.5
  )
  assert.equal(ok, false)
  assert.equal(target.platform, 'RealPlatform')
})

test('make 抛：返回 false，不冒泡', () => {
  const target: Record<string, unknown> = { platform: 'RealPlatform' }
  const ok = installHook(
    target,
    'platform',
    () => {
      throw new Error('boom')
    },
    () => 0.5
  )
  assert.equal(ok, false)
  assert.equal(target.platform, 'RealPlatform')
})

test('自己人：markOurs 的对象被 isOurs 认出，未登记的认不出', () => {
  const mine = markOurs({ a: 1 })
  assert.equal(isOurs(mine), true)
  assert.equal(isOurs({ a: 1 }), false)
  assert.equal(isOurs(null), false)
  assert.equal(isOurs(42), false)
})
