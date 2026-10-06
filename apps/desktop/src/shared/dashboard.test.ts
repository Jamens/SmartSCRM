// src/shared/dashboard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dashboardCsv } from './dashboard.ts'

const overview = {
  accountsOnline: 2, accountsTotal: 8, customersTotal: 6, conversationsTotal: 56,
  tasksRunning: 0, tasksTotal: 78, messageIn: 227, messageOut: 66, messageTotal: 293,
  activeConversations: 55,
  perDay: [{ day: '2026-10-01', inCount: 1, outCount: 2 }, { day: '2026-10-02', inCount: 0, outCount: 0 }]
}

test('dashboardCsv 含 BOM 与总览关键指标', () => {
  const csv = dashboardCsv(overview, [])
  assert.ok(csv.startsWith('﻿'), '应以 BOM 开头（Excel 中文不乱码）')
  assert.ok(csv.includes('账号在线,2'))
  assert.ok(csv.includes('消息合计,293'))
})

test('dashboardCsv 逐日趋势与账号下钻各成一段', () => {
  const csv = dashboardCsv(overview, [
    { accountId: 7, accountName: 'WA-A', online: true, messageIn: 10, messageOut: 5, activeConversations: 3 }
  ])
  assert.ok(csv.includes('日期,收,发'))
  assert.ok(csv.includes('2026-10-01,1,2'))
  assert.ok(csv.includes('账号ID,账号名,在线,收,发,活跃会话'))
  assert.ok(csv.includes('7,WA-A,是,10,5,3'))
})

test('dashboardCsv 账号名含逗号/引号时正确转义', () => {
  const csv = dashboardCsv(overview, [
    { accountId: 1, accountName: 'a,b"c', online: false, messageIn: 0, messageOut: 0, activeConversations: 0 }
  ])
  assert.ok(csv.includes('"a,b""c"'), '逗号/引号要按 CSV 规则转义')
})
