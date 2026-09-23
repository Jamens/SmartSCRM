// src/shared/translateKey.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translateKey } from './translateKey.ts'

test('same text in two chats are two requests', () => {
  const a = translateKey({ type: 'receive', chatHint: 'Alice', text: 'Good morning' })
  const b = translateKey({ type: 'receive', chatHint: 'Bob', text: 'Good morning' })
  assert.notEqual(a, b)
})

test('chat hint changes nothing else about the key', () => {
  assert.equal(
    translateKey({ type: 'receive', chatHint: null, text: 'x' }),
    translateKey({ type: 'receive', text: 'x' }),
    'null 与不带提示都是"没有会话上下文"，不该分两次请求'
  )
})

test('chatHint 里带分隔符也不越界撞键：编码只加在 chatHint，text 是末段不用管', () => {
  // 不编码时两者都拼成 `receive|f|a|b|c`——一个 chatHint='a|b' 的会话和一个 text='b|c' 的会话共用一次 inflight promise。
  const x = translateKey({ type: 'receive', chatHint: 'a|b', text: 'c' })
  const y = translateKey({ type: 'receive', chatHint: 'a', text: 'b|c' })
  assert.notEqual(x, y)
})

test('input preview never shares a slot with a bubble', () => {
  assert.notEqual(
    translateKey({ type: 'send', input: true, chatHint: 'Alice', text: '你好' }),
    translateKey({ type: 'send', chatHint: 'Alice', text: '你好' })
  )
})
