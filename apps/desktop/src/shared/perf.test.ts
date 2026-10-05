// src/shared/perf.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpuTotalSec,
  formatDuration,
  perfRows,
  type PerfMetrics
} from './perf.ts'
import { UNKNOWN_TEXT } from './machine.ts'

function metrics(overrides: Partial<PerfMetrics> = {}): PerfMetrics {
  return {
    rss: 200 * 1024 * 1024,
    heapTotal: 100 * 1024 * 1024,
    heapUsed: 50 * 1024 * 1024,
    external: 10 * 1024 * 1024,
    uptimeSec: 3661,
    cpuUserSec: 30,
    cpuSystemSec: 12,
    ...overrides
  }
}

test('formatDuration: seconds / minutes / hours', () => {
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(125), '2m 5s')
  assert.equal(formatDuration(3661), '1h 1m')
})

test('formatDuration: invalid → UNKNOWN', () => {
  assert.equal(formatDuration(null), UNKNOWN_TEXT)
  assert.equal(formatDuration(undefined), UNKNOWN_TEXT)
  assert.equal(formatDuration(-1), UNKNOWN_TEXT)
  assert.equal(formatDuration(NaN), UNKNOWN_TEXT)
})

test('cpuTotalSec sums user+system, null when metrics missing', () => {
  assert.equal(cpuTotalSec(metrics()), 42)
  assert.equal(cpuTotalSec(null), null)
})

test('perfRows returns the fixed row order', () => {
  const keys = perfRows(metrics()).map((r) => r.key)
  assert.deepEqual(keys, [
    'memory.rss',
    'memory.heapUsed',
    'memory.heapTotal',
    'memory.external',
    'runtime.uptime',
    'cpu.total'
  ])
})

test('perfRows formats byte rows via readable units', () => {
  const rss = perfRows(metrics({ rss: 200 * 1024 * 1024 })).find((r) => r.key === 'memory.rss')
  assert.equal(rss?.value, '200.0 MB')
})

test('perfRows on null metrics → every row UNKNOWN (0 must be distinguishable)', () => {
  const rows = perfRows(null)
  assert.equal(rows.length, 6)
  rows.forEach((r) => assert.equal(r.value, UNKNOWN_TEXT))
})
