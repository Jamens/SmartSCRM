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

test('input preview never shares a slot with a bubble', () => {
  assert.notEqual(
    translateKey({ type: 'send', input: true, chatHint: 'Alice', text: '你好' }),
    translateKey({ type: 'send', chatHint: 'Alice', text: '你好' })
  )
})
