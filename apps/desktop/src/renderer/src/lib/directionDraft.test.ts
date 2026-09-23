// src/renderer/src/lib/directionDraft.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionSummary, dirtyCount, draftOf, type DirectionSource } from './directionDraft.ts'

/** 一份"完整设置"：语向六字段之外还有 channel / server / previewEnabled 等，弹层一个都不许带走。 */
const WHOLE = {
  channel: 'simulate',
  server: 'node-a',
  serverMode: 'auto',
  previewEnabled: true,
  receiveEnabled: true,
  receiveFromLang: 'en',
  receiveToLang: 'zh-CN',
  sendEnabled: false,
  sendFromLang: 'zh-CN',
  sendToLang: 'vi',
  voiceEnabled: false,
  enterToSend: true,
  disableChinese: true,
  disableChinesePreventSend: false
}

test('draftOf 只取那六个字段', () => {
  assert.deepEqual(Object.keys(draftOf(WHOLE)).sort(), [
    'receiveEnabled',
    'receiveFromLang',
    'receiveToLang',
    'sendEnabled',
    'sendFromLang',
    'sendToLang'
  ])
  assert.equal(draftOf(WHOLE).receiveToLang, 'zh-CN')
})

test('同义值不算改动：P5 的下拉写 `""`，Task 6 的契约写 `"auto"`，两者都是"自动检测"', () => {
  const base: DirectionSource = { ...draftOf(WHOLE), receiveFromLang: '' }
  const next: DirectionSource = { ...draftOf(WHOLE), receiveFromLang: 'auto' }
  assert.equal(dirtyCount(base, next), 0)
  assert.equal(dirtyCount(base, { ...base, receiveFromLang: 'en' }), 1)
})

test('改动处数逐字段累加，开关也算一处', () => {
  const base = draftOf(WHOLE)
  assert.equal(dirtyCount(base, base), 0)
  assert.equal(dirtyCount(base, { ...base, sendToLang: 'th' }), 1)
  assert.equal(dirtyCount(base, { ...base, sendEnabled: true, receiveToLang: 'ja' }), 2)
})

test('摘要文案：源为空显示 auto，目标为空显示未配置', () => {
  assert.equal(directionSummary({ ...draftOf(WHOLE), receiveFromLang: '' }, 'receive'), 'auto → zh-CN')
  assert.equal(directionSummary(draftOf(WHOLE), 'send'), 'zh-CN → vi')
  assert.equal(directionSummary({ ...draftOf(WHOLE), sendToLang: '' }, 'send'), '未配置')
})
