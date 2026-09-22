// src/renderer/src/lib/sendDraft.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideDraft, MAX_DRAFT_LEN, type DraftFlags } from './sendDraft.ts'

const flags = (over: Partial<DraftFlags> = {}): DraftFlags => ({
  sendEnabled: true,
  disableChinese: false,
  disableChinesePreventSend: false,
  ...over
})

test('空草稿与纯空白都不发：不能把回车当成一条消息', () => {
  assert.deepEqual(decideDraft('', flags()), { kind: 'empty' })
  assert.deepEqual(decideDraft('   \n  ', flags()), { kind: 'empty' })
})

test('长度边界：5000 放行、5001 拒绝（与主进程 isSendable 同一口径）', () => {
  assert.equal(MAX_DRAFT_LEN, 5_000)
  assert.deepEqual(decideDraft('a'.repeat(MAX_DRAFT_LEN), flags({ sendEnabled: false })), {
    kind: 'plain',
    text: 'a'.repeat(MAX_DRAFT_LEN)
  })
  assert.deepEqual(decideDraft('a'.repeat(MAX_DRAFT_LEN + 1), flags()), { kind: 'tooLong' })
})

test('开关关着就是原文直发，且发出去的是 trim 过的', () => {
  assert.deepEqual(decideDraft('  hello  ', flags({ sendEnabled: false })), { kind: 'plain', text: 'hello' })
})

test('开关开着走译文通道', () => {
  assert.deepEqual(decideDraft('hello', flags({ sendEnabled: true })), { kind: 'translate', text: 'hello' })
})

test('中文拦截：开着拦截时给出与注入层一致的文案', () => {
  const d = decideDraft('你好，我想问下订单', flags({ sendEnabled: false, disableChinese: true, disableChinesePreventSend: true }))
  assert.deepEqual(d, { kind: 'blocked', reason: '消息含中文，已拦截发送' })
})

test('只开 disableChinese 不开 preventSend 时不拦（那是提示，不是闸门）', () => {
  const d = decideDraft('你好', flags({ disableChinese: true, disableChinesePreventSend: false }))
  assert.equal(d.kind, 'translate')
})

test('拦截优先于翻译：先译后拦等于把中文交给厂商接口再照发', () => {
  const d = decideDraft('你好', flags({ sendEnabled: true, disableChinese: true, disableChinesePreventSend: true }))
  assert.equal(d.kind, 'blocked')
  // 区分性证据：判定顺序写反时这里会是 'translate'，端到端看起来"也拦了一下"但其实消息发出去了
  assert.notEqual(d.kind, 'translate')
})

test('全角标点与假名不算中文：只按 CJK 统一表意文字判', () => {
  const d = decideDraft('こんにちは！オーバーです：OK', flags({ disableChinese: true, disableChinesePreventSend: true }))
  assert.equal(d.kind, 'translate')
  // 反证：同一串里只把假名换成表意文字（価 U+4FA1 / 格 U+683C 都在 \u4e00-\u9fa5 里）就必须拦住。
  // 「日文汉字算不算中文」这条界只能这样两侧各钉一次，只测放行那侧时 regex 写成 [ぁ-ん] 也照样绿。
  assert.equal(
    decideDraft('こんにちは！価格：OK', flags({ disableChinese: true, disableChinesePreventSend: true })).kind,
    'blocked'
  )
})
