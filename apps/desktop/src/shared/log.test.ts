import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatLogLine, inferCategory, parseTag, type LogEntry } from './log.ts'

test('inferCategory: error 级别一律归 error 类（不论 tag）', () => {
  assert.equal(inferCategory('batch', 'error'), 'error')
  assert.equal(inferCategory(null, 'error'), 'error')
})

test('inferCategory: 已知 tag 映射到对应类', () => {
  assert.equal(inferCategory('msgBridge', 'info'), 'bridge')
  assert.equal(inferCategory('inject', 'warn'), 'bridge')
  assert.equal(inferCategory('batch', 'info'), 'bridge')
  assert.equal(inferCategory('ipc', 'info'), 'ipc')
  assert.equal(inferCategory('settings', 'info'), 'app')
  assert.equal(inferCategory('badge', 'warn'), 'app')
})

test('inferCategory: 无 tag 默认 app 类', () => {
  assert.equal(inferCategory(null, 'info'), 'app')
})

test('parseTag: 提取开头 [tag]', () => {
  assert.equal(parseTag('[msgBridge] 挂载账号'), 'msgBridge')
  assert.equal(parseTag('没有 tag 的行'), null)
  assert.equal(parseTag(123), null)
})

test('formatLogLine: 含 iso/level/category/message，无 meta 不附', () => {
  const e: LogEntry = {
    id: 1,
    ts: 1_700_000_000_000,
    category: 'bridge',
    level: 'warn',
    message: 'timeout'
  }
  assert.equal(
    formatLogLine(e),
    '2023-11-14T22:13:20.000Z [WARN] [bridge] timeout'
  )
})

test('formatLogLine: 对象 meta 序列化成字符串附在行尾', () => {
  const e: LogEntry = {
    id: 2,
    ts: 0,
    category: 'ipc',
    level: 'info',
    message: 'invoke',
    meta: { channel: 'settings:get', ms: 3 }
  }
  assert.equal(formatLogLine(e), '1970-01-01T00:00:00.000Z [INFO] [ipc] invoke :: {"channel":"settings:get","ms":3}')
})
