import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GPU_DEGRADED_FLAG, nextRelaunchArgs, resolveDesiredDegraded } from './gpu.ts'

test('resolveDesiredDegraded: 标准态默认不降级', () => {
  assert.equal(
    resolveDesiredDegraded({ hardwareAcceleration: true, gpuSafeMode: false, launchedDegraded: false }),
    false
  )
})

test('resolveDesiredDegraded: 用户关掉硬件加速即降级', () => {
  assert.equal(
    resolveDesiredDegraded({ hardwareAcceleration: false, gpuSafeMode: false, launchedDegraded: false }),
    true
  )
})

test('resolveDesiredDegraded: 历史崩溃留下的安全标记即降级', () => {
  assert.equal(
    resolveDesiredDegraded({ hardwareAcceleration: true, gpuSafeMode: true, launchedDegraded: false }),
    true
  )
})

test('resolveDesiredDegraded: 带着降级参数启动即降级（与偏好无关）', () => {
  assert.equal(
    resolveDesiredDegraded({ hardwareAcceleration: true, gpuSafeMode: false, launchedDegraded: true }),
    true
  )
})

test('nextRelaunchArgs: 标准态去掉降级 flag', () => {
  const args = ['--no-sandbox', GPU_DEGRADED_FLAG, 'app://.']
  assert.deepEqual(nextRelaunchArgs(args, false), ['--no-sandbox', 'app://.'])
})

test('nextRelaunchArgs: 降级态补上 flag 且不去重叠加', () => {
  const args = ['--no-sandbox', GPU_DEGRADED_FLAG]
  assert.deepEqual(nextRelaunchArgs(args, true), ['--no-sandbox', GPU_DEGRADED_FLAG])
})

test('nextRelaunchArgs: 空参数降级态只带 flag', () => {
  assert.deepEqual(nextRelaunchArgs([], true), [GPU_DEGRADED_FLAG])
})
