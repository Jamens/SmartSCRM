// src/shared/degradeCopy.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEAD_FALLBACK_LABEL, degradeCopy, RETRY_LABEL } from './degradeCopy.ts'

/**
 * 降级在页面上有两种形状：厂商瞬时故障（点一次可能就好了）与配置性死路（点一万次也不会好）。
 * 分岔的证人只有一个字段——后端的 `degradeRetryable`（由抛出点的 `ProviderException.retryable()` 带来）。
 * 这一份不证按钮怎么画（那是注入层 + CDP 实机腿），只证"给不给那颗按钮"和"那句话怎么说"。
 */
test('非降级没有形状可画：既不给按钮也不给说明', () => {
  assert.deepEqual(degradeCopy(null), { shape: 'none', label: '' })
  assert.deepEqual(degradeCopy(undefined), { shape: 'none', label: '' })
  assert.deepEqual(degradeCopy({ degraded: false, degradeReason: '不该被读到的原因' }), {
    shape: 'none',
    label: ''
  })
})

test('可重试的降级保持原来那句，文案里不带厂商错误', () => {
  const read = degradeCopy({ degraded: true, degradeRetryable: true, degradeReason: '百度 HTTP 500' })
  assert.equal(read.shape, 'retry')
  assert.equal(read.label, '翻译失败 · 点此重试')
  assert.equal(read.label, RETRY_LABEL)
})

test('后端没给 retryable 字段时退成可重试：缺字段不等于死路', () => {
  // 旧一份后端（或主进程透传丢字段）只会缺 `degradeRetryable`，不会给出 false。
  // 判成死路会把一次真能救回来的重译入口悄悄收掉——那是比"点了没用"更坏的错。
  const read = degradeCopy({ degraded: true, degradeReason: '百度 接口不可用: timeout' })
  assert.equal(read.shape, 'retry')
  assert.equal(read.label, RETRY_LABEL)
})

test('死路把原因念出来，并且不再挂重试', () => {
  const read = degradeCopy({
    degraded: true,
    degradeRetryable: false,
    degradeReason: 'tencent 未配置密钥，此结果来自本地模拟引擎'
  })
  assert.equal(read.shape, 'dead')
  assert.equal(read.label, '翻译失败（重试无效）· tencent 未配置密钥，此结果来自本地模拟引擎')
})

test('死路但后端没给原因时走兜底句，不许漏出 undefined', () => {
  for (const reason of [null, undefined, '   ']) {
    const read = degradeCopy({ degraded: true, degradeRetryable: false, degradeReason: reason })
    assert.equal(read.shape, 'dead')
    assert.equal(read.label, DEAD_FALLBACK_LABEL)
    assert.equal(read.label.includes('undefined'), false, read.label)
    assert.equal(read.label.includes('null'), false, read.label)
  }
})
