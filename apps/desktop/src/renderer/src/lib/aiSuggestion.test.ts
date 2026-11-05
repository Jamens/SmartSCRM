// src/renderer/src/lib/aiSuggestion.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { canGenerate, sourceBadge, type SuggestionSource } from './aiSuggestion.ts'

/**
 * B28 接管台的两个纯判定（不碰 React / http，node:test 直接跑）。
 *
 * 重点是「未绑人设 = 无模型路径」（S4）：前端禁用只是第一道闸，后端仍会拒，
 * 所以这里必须验证前端不会把一个没绑人设的会话放行到生成请求。
 */
const base = {
  id: 1,
  chatKey: 'a@b',
  platform: 'whatsapp',
  title: null,
  handlingStatus: 'WAITING_TAKEOVER',
  waitTakeoverAt: null,
  transferReason: null,
  aiSuggestion: null,
  aiSuggestionScore: null,
  aiSuggestionQaId: null,
  aiSuggestionSource: null,
  aiPersonaId: null
}

test('未绑人设时禁用生成按钮', () => {
  assert.equal(canGenerate({ ...base, aiPersonaId: null }, false), false)
})

test('已绑人设且非生成中时允许生成', () => {
  assert.equal(canGenerate({ ...base, aiPersonaId: 7 }, false), true)
})

test('生成中不重复放行（防连点打爆本地端点）', () => {
  assert.equal(canGenerate({ ...base, aiPersonaId: 7 }, true), false)
})

test('来源映射：retrieval=知识库标准答案 / model=人设生成', () => {
  assert.equal(sourceBadge('retrieval'), 'ai.queue.sourceKnowledge')
  assert.equal(sourceBadge('model'), 'ai.queue.sourceModel')
})

test('无来源或未知来源不显示徽标（老数据不误标）', () => {
  assert.equal(sourceBadge(null), null)
  assert.equal(sourceBadge(undefined), null)
  assert.equal(sourceBadge('legacy' as SuggestionSource), null)
  assert.equal(sourceBadge(''), null)
})
