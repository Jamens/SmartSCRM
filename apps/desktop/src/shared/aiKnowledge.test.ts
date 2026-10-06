// src/shared/aiKnowledge.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveQaPreview } from './aiKnowledge.ts'

test('分片：首行作问、其余作答', () => {
  const cands = deriveQaPreview('怎么申请退款？\n在订单页点退款即可\n一般 3 天到账')
  assert.equal(cands.length, 1)
  assert.equal(cands[0].question, '怎么申请退款？')
  assert.equal(cands[0].answer, '在订单页点退款即可\n一般 3 天到账')
})

test('分片：空行分块，一块一条候选', () => {
  const cands = deriveQaPreview('问题一是什么？\n答案一内容\n\n问题二是什么？\n答案二内容')
  assert.equal(cands.length, 2)
  assert.equal(cands[0].question, '问题一是什么？')
  assert.equal(cands[1].question, '问题二是什么？')
})

test('分片：只有一行（无答）丢弃', () => {
  assert.equal(deriveQaPreview('这是一个孤立标题行').length, 0)
})

test('分片：问题或答案过短丢弃', () => {
  assert.equal(deriveQaPreview('问？\n答').length, 0) // 都 < 4
  assert.equal(deriveQaPreview('够长的问题行？\n短').length, 0) // 答案 < 4
})

test('分片：空/空白/无分块返回空数组（交人工）', () => {
  assert.deepEqual(deriveQaPreview(''), [])
  assert.deepEqual(deriveQaPreview('   \n\n  '), [])
  assert.deepEqual(deriveQaPreview(null), [])
  assert.deepEqual(deriveQaPreview(undefined), [])
})

test('分片：容忍 CRLF 与块内多空行', () => {
  const cands = deriveQaPreview('怎么开发票？\r\n在个人中心\r\n申请')
  assert.equal(cands.length, 1)
  assert.equal(cands[0].question, '怎么开发票？')
  assert.equal(cands[0].answer, '在个人中心\n申请')
})
