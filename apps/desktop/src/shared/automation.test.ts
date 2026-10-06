// src/shared/automation.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTasksOfAccount, aggregateTaskStatus, countTasksByAccount, isActiveTask, shouldStopBeforeDelete, toAccountIds,
  type AutomationTask
} from './automation.ts'

const t = (id: number, kind: AutomationTask['kind'], status: string, accountIds: number[]): AutomationTask =>
  ({ id, kind, status, accountIds })

// ===== 归属账号解析：标量 vs JSON 数组 =====

test('toAccountIds 同时吃标量与 JSON 数组（B9 是多账号）', () => {
  assert.deepEqual(toAccountIds(3), [3], '标量')
  assert.deepEqual(toAccountIds('[2,6,7]'), [2, 6, 7], 'JSON 数组（B9 形态）')
  assert.deepEqual(toAccountIds([2, 6]), [2, 6], '已是数组')
  assert.deepEqual(toAccountIds(null), [])
  assert.deepEqual(toAccountIds(''), [])
})

test('toAccountIds 脏数据跳过不抛', () => {
  assert.deepEqual(toAccountIds('["a","2"]'), [2], '非数字项滤掉')
  assert.deepEqual(toAccountIds('[bad]'), [])
})

// ===== 按账号计数：B9 数组不能漏 =====

test('countTasksByAccount 跨来源按账号计数，含 B9 多账号', () => {
  const tasks = [
    t(1, 'script', 'running', [2]),       // B8 单账号
    t(2, 'nurture', 'running', [2, 6, 7]), // B9 多账号 —— 关键：按标量比会漏
    t(3, 'groupJoin', 'pending', [6]),
    t(4, 'groupKick', 'running', [7])
  ]
  assert.equal(countTasksByAccount(tasks, 2), 2, '账号2 挂在 B8 + B9 上')
  assert.equal(countTasksByAccount(tasks, 6), 2, '账号6 挂在 B9 + B18 上')
  assert.equal(countTasksByAccount(tasks, 7), 2, '账号7 挂在 B9 + B19 上')
  assert.equal(countTasksByAccount(tasks, 99), 0, '无关账号为 0')
})

// ===== 状态聚合 =====

test('aggregateTaskStatus 按来源+状态交叉计数', () => {
  const got = aggregateTaskStatus([
    t(1, 'script', 'running', [1]),
    t(2, 'script', 'running', [1]),
    t(3, 'script', 'done', [1]),
    t(4, 'nurture', 'confirmed', [2])
  ])
  assert.equal(got.script.running, 2)
  assert.equal(got.script.done, 1)
  assert.equal(got.nurture.confirmed, 1)
})

// ===== 在跑 / 终态 =====

test('isActiveTask 非终态算在跑', () => {
  assert.equal(isActiveTask(t(1, 'script', 'running', [1])), true)
  assert.equal(isActiveTask(t(1, 'script', 'pending', [1])), true)
  assert.equal(isActiveTask(t(1, 'script', 'confirmed', [1])), true)
  assert.equal(isActiveTask(t(1, 'script', 'done', [1])), false)
  assert.equal(isActiveTask(t(1, 'script', 'error', [1])), false)
  assert.equal(isActiveTask(t(1, 'script', 'cancelled', [1])), false)
})

test('activeTasksOfAccount 只挑该账号的在跑任务', () => {
  const tasks = [
    t(1, 'script', 'running', [2]),
    t(2, 'script', 'done', [2]),      // 终态不挑
    t(3, 'nurture', 'running', [2, 6]) // B9 多账号命中 2
  ]
  const got = activeTasksOfAccount(tasks, 2)
  assert.equal(got.length, 2, 'running 的 B8 + B9（done 的不挑）')
})

test('shouldStopBeforeDelete 有在跑任务才需先停', () => {
  assert.equal(shouldStopBeforeDelete(0), false)
  assert.equal(shouldStopBeforeDelete(1), true)
})
