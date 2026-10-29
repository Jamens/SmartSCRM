// src/main/services/fingerprint/runtime.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntime, type FingerprintProfileRow, type FingerprintSettings } from './runtime.ts'

/** 一份"什么都配了"的档案：用例只覆盖自己关心的字段，其余保持有值。 */
function fullRow(over: Partial<FingerprintProfileRow> = {}): FingerprintProfileRow {
  return {
    profileId: 11,
    seed: 424242,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    uaPlatform: 'Windows',
    uaPlatformVersion: '15.0.0',
    brands: [{ brand: 'Chromium', version: '140' }],
    locale: 'en-US',
    timezone: 'America/New_York',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)',
    canvasNoiseSeed: 3146166556,
    audioNoiseSeed: 2236327244,
    ...over
  }
}

const ON: FingerprintSettings = { enabled: true, toggles: {} }

/** 除 profileId / seed 外全空：等于没配。 */
function emptyRow(): FingerprintProfileRow {
  return {
    profileId: 11,
    seed: 424242,
    userAgent: null,
    uaPlatform: null,
    uaPlatformVersion: null,
    brands: null,
    locale: null,
    timezone: null,
    hardwareConcurrency: null,
    deviceMemory: null,
    webglVendor: null,
    webglRenderer: null,
    canvasNoiseSeed: null,
    audioNoiseSeed: null
  }
}

test('未绑档案 → null（R2：未绑定不施加任何指纹，绝不兜底生成一份）', () => {
  assert.equal(resolveRuntime(null, ON), null)
  assert.equal(resolveRuntime(undefined, ON), null)
})

test('全局开关关 → null（R9）', () => {
  assert.equal(resolveRuntime(fullRow(), { enabled: false, toggles: {} }), null)
})

test('档案除 profileId/seed 外全空 → null（等于没配）', () => {
  assert.equal(resolveRuntime(emptyRow(), ON), null)
})

test('关掉单项 → 该项为 false，其余仍为 true（R9 单项开关）', () => {
  const rt = resolveRuntime(fullRow(), { enabled: true, toggles: { canvas: false } })
  assert.ok(rt)
  assert.equal(rt.toggles.canvas, false)
  assert.equal(rt.toggles.navigator, true, '没出现在 toggles 里的项视为开')
  assert.equal(rt.toggles.timezone, true)
})

test('缺 timezone → runtime.timezone 为 undefined（不是空串、不是 UTC）', () => {
  const rt = resolveRuntime(fullRow({ timezone: null }), ON)
  assert.ok(rt)
  assert.equal(rt.timezone, undefined)
  assert.ok(!('UTC' === rt.timezone), '不得兜底成 UTC')
})

test('缺 brands → undefined', () => {
  const rt = resolveRuntime(fullRow({ brands: null }), ON)
  assert.ok(rt)
  assert.equal(rt.brands, undefined)
})

test('brands 为空数组 → 保留空数组（空是显式意图，与缺失是两回事）', () => {
  const rt = resolveRuntime(fullRow({ brands: [] }), ON)
  assert.ok(rt, '全空档案才短路；显式给了空 brands 的档案不算"没配"')
  assert.ok(Array.isArray(rt.brands))
  assert.equal(rt.brands.length, 0)
})

test('canvasNoiseSeed 为 null → undefined', () => {
  const rt = resolveRuntime(fullRow({ canvasNoiseSeed: null }), ON)
  assert.ok(rt)
  assert.equal(rt.canvasNoiseSeed, undefined)
  assert.equal(rt.audioNoiseSeed, 2236327244, '另一个种子不受牵连')
})

test('逐字段搬运：非空原样搬，0 是有效值不是缺失', () => {
  const rt = resolveRuntime(fullRow({ hardwareConcurrency: 0, deviceMemory: 0 }), ON)
  assert.ok(rt)
  assert.equal(rt.profileId, 11)
  assert.equal(rt.seed, 424242)
  assert.equal(rt.userAgent, fullRow().userAgent)
  assert.equal(rt.hardwareConcurrency, 0, '0 核不是"没配"，不得当缺失丢掉')
  assert.equal(rt.deviceMemory, 0)
  assert.deepEqual(rt.brands, [{ brand: 'Chromium', version: '140' }])
})

test('空串按缺项处理（空串不是有效值）', () => {
  const rt = resolveRuntime(fullRow({ locale: '', webglVendor: '' }), ON)
  assert.ok(rt)
  assert.equal(rt.locale, undefined)
  assert.equal(rt.webglVendor, undefined)
})
