// src/renderer/src/lib/sendDraft.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideDraft, gateDraft, MAX_DRAFT_LEN, type DraftFlags } from './sendDraft.ts'

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
  assert.deepEqual(decideDraft('  hello  ', flags({ sendEnabled: false })), {
    kind: 'plain',
    text: 'hello'
  })
})

test('开关开着走译文通道', () => {
  assert.deepEqual(decideDraft('hello', flags({ sendEnabled: true })), {
    kind: 'translate',
    text: 'hello'
  })
})

test('中文拦截：开着拦截时给出与注入层一致的文案', () => {
  const d = decideDraft(
    '你好，我想问下订单',
    flags({ sendEnabled: false, disableChinese: true, disableChinesePreventSend: true })
  )
  assert.deepEqual(d, { kind: 'blocked', reason: '消息含中文，已拦截发送' })
})

test('只开 disableChinese 不开 preventSend 时不拦（那是提示，不是闸门）', () => {
  const d = decideDraft('你好', flags({ disableChinese: true, disableChinesePreventSend: false }))
  assert.equal(d.kind, 'translate')
})

test('拦截优先于翻译：先译后拦等于把中文交给厂商接口再照发', () => {
  const d = decideDraft(
    '你好',
    flags({ sendEnabled: true, disableChinese: true, disableChinesePreventSend: true })
  )
  // 这条 deepEqual 就是判定顺序的判别子：顺序写反（先决定要不要翻、再判拦）时它是
  // `{kind:'translate', text:'你好'}`，端到端看起来"也拦了一下"但其实消息发出去了（C1）。
  // 原来跟在它后面的那句 `assert.notEqual(d.kind, 'translate')` 已被这条完全盖住（同义反复），删掉。
  assert.deepEqual(d, { kind: 'blocked', reason: '消息含中文，已拦截发送' })
})

test('全角标点与假名不算中文：只按 CJK 统一表意文字判', () => {
  const d = decideDraft(
    'こんにちは！オーバーです：OK',
    flags({ disableChinese: true, disableChinesePreventSend: true })
  )
  assert.equal(d.kind, 'translate')
  // 反证：同一串里只把假名换成表意文字（価 U+4FA1 / 格 U+683C 都在 \u4e00-\u9fa5 里）就必须拦住。
  // 「日文汉字算不算中文」这条界只能这样两侧各钉一次，只测放行那侧时 regex 写成 [ぁ-ん] 也照样绿。
  assert.equal(
    decideDraft(
      'こんにちは！価格：OK',
      flags({ disableChinese: true, disableChinesePreventSend: true })
    ).kind,
    'blocked'
  )
})

// —— 下面是 Task 15 评审补的 `gateDraft`：重试插槽用的就是它（失败气泡不只挂在应用发的那条上）。

test('gateDraft 不看译文开关：三条出口在 sendEnabled 两侧同形', () => {
  const blocked = { kind: 'blocked', reason: '消息含中文，已拦截发送' }
  // 「要不要先翻一遍」不是「能不能发」。把拦截写成只在原文直发那条路上生效（= 闸门偷偷读了
  // sendEnabled），上面两条就会分叉：开着译文通道时中文被放行成 ok。
  assert.deepEqual(
    gateDraft(
      '你好',
      flags({ sendEnabled: true, disableChinese: true, disableChinesePreventSend: true })
    ),
    blocked
  )
  assert.deepEqual(
    gateDraft(
      '你好',
      flags({ sendEnabled: false, disableChinese: true, disableChinesePreventSend: true })
    ),
    blocked
  )
  assert.deepEqual(gateDraft('hello', flags({ sendEnabled: true })), { kind: 'ok' })
  assert.deepEqual(gateDraft('hello', flags({ sendEnabled: false })), { kind: 'ok' })
  assert.deepEqual(gateDraft('a'.repeat(MAX_DRAFT_LEN + 1), flags({ sendEnabled: true })), {
    kind: 'tooLong'
  })
  assert.deepEqual(gateDraft('a'.repeat(MAX_DRAFT_LEN + 1), flags({ sendEnabled: false })), {
    kind: 'tooLong'
  })
})

test('gateDraft：拦下时给出与注入层一致的同一句 reason，只开提示不拦', () => {
  assert.deepEqual(
    gateDraft(
      '你好，我想问下订单',
      flags({ disableChinese: true, disableChinesePreventSend: true })
    ),
    { kind: 'blocked', reason: '消息含中文，已拦截发送' }
  )
  // 与 decideDraft 同一口径：disableChinese 单独开着是提示，不是闸门。
  assert.deepEqual(
    gateDraft('你好', flags({ disableChinese: true, disableChinesePreventSend: false })),
    { kind: 'ok' }
  )
  assert.deepEqual(
    gateDraft('你好', flags({ disableChinese: false, disableChinesePreventSend: true })),
    { kind: 'ok' }
  )
})

test('gateDraft：长度量的是 trim 之后的那份，与 decideDraft 同一个边界', () => {
  assert.deepEqual(gateDraft('a'.repeat(MAX_DRAFT_LEN), flags()), { kind: 'ok' })
  assert.deepEqual(gateDraft('a'.repeat(MAX_DRAFT_LEN + 1), flags()), { kind: 'tooLong' })
  // 原始长度 5004、trim 后 5000：发出去的是 trim 过的那份，所以闸门量的也必须是它。
  assert.deepEqual(gateDraft(`  ${'a'.repeat(MAX_DRAFT_LEN)}  `, flags()), { kind: 'ok' })
})

test('gateDraft 与 decideDraft 不分叉：重试再也绕不过回复框的闸', () => {
  const cases: Array<[string, Partial<DraftFlags>]> = [
    ['你好', { sendEnabled: true, disableChinese: true, disableChinesePreventSend: true }],
    ['你好', { sendEnabled: false, disableChinese: true, disableChinesePreventSend: true }],
    ['你好', { disableChinese: true, disableChinesePreventSend: false }],
    ['a'.repeat(MAX_DRAFT_LEN + 1), { sendEnabled: true }],
    ['a'.repeat(MAX_DRAFT_LEN), { disableChinese: true, disableChinesePreventSend: true }],
    ['こんにちは！オーバーです：OK', { disableChinese: true, disableChinesePreventSend: true }],
    ['你好 hello', { sendEnabled: true, disableChinese: true, disableChinesePreventSend: true }],
    ['hello', {}],
    // 全空白：回复框给的是 `empty`（"没有内容"），闸门给的是 `ok`——判空按 `gateDraft` 的文档
    // 注释归调用方，所以这一条钉的就是"闸门不管空"这件事本身。
    ['   \n ', { disableChinese: true, disableChinesePreventSend: true }]
  ]
  for (const [raw, over] of cases) {
    const f = flags(over)
    const decision = decideDraft(raw, f)
    const gate = gateDraft(raw, f)
    // 两个函数读的是同一个上限与同一个 regex，所以"回复框拦下的"与"重试拦下的"必须逐字相同；
    // 将来谁把其中一处的判定抄成自己的一份，这里就会分叉。
    if (decision.kind === 'blocked' || decision.kind === 'tooLong') {
      assert.deepEqual(gate, decision, `${raw.slice(0, 8)}…：回复框拦下的结论，重试也必须拦下`)
    } else {
      assert.deepEqual(
        gate,
        { kind: 'ok' },
        `${raw.slice(0, 8)}…：回复框没有拦，重试不能另加一道闸`
      )
    }
  }
})
