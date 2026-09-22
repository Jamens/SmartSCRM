// src/renderer/src/lib/chatDays.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, groupByDay, listTime } from './chatDays.ts'

const row = (ts: number, msgKey: string): { ts: number; msgKey: string } => ({ ts, msgKey })

/** 用本地时间构造测试数据：断言与跑机器的时区无关。 */
const local = (y: number, m: number, d: number, hh = 12, mm = 0): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

const dayKey = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

test('按本地日切段，段内保持升序', () => {
  const rows = [row(local(2026, 9, 19, 23, 59), 'a'), row(local(2026, 9, 20, 0, 1), 'b')]
  const sections = groupByDay(rows)
  assert.deepEqual(
    sections.map((s) => s.day),
    [dayKey(2026, 9, 19), dayKey(2026, 9, 20)]
  )
  assert.deepEqual(
    sections.map((s) => s.rows.map((r) => r.msgKey)),
    [['a'], ['b']]
  )
  // 只有一条时也必须是"一段"，不是"零段"——右列空白是最难看的回归
  assert.equal(groupByDay([rows[0]]).length, 1)
  assert.deepEqual(groupByDay([]), [])
})

test('输入乱序也要切对：合并尾巴可能把昨天的帧送到今天那页后面', () => {
  const rows = [
    row(local(2026, 9, 20, 9), 'c'),
    row(local(2026, 9, 19, 20), 'a'),
    row(local(2026, 9, 20, 8), 'b')
  ]
  const sections = groupByDay(rows)
  assert.deepEqual(
    sections.map((s) => s.day),
    [dayKey(2026, 9, 19), dayKey(2026, 9, 20)]
  )
  assert.deepEqual(
    sections[1].rows.map((r) => r.msgKey),
    ['b', 'c']
  )
  // 区分性证据：不排序时同一天会切成两段，页面上出现两个「9月20日」日头
  assert.equal(sections.length, 2)
})

test('日头文案：今天 / 昨天 / 今年内到月日 / 跨年带年份', () => {
  const now = local(2026, 9, 20, 12, 0)
  assert.equal(dayLabel(dayKey(2026, 9, 20), now), '今天')
  assert.equal(dayLabel(dayKey(2026, 9, 19), now), '昨天')
  assert.equal(dayLabel(dayKey(2026, 1, 5), now), '1月5日')
  assert.equal(dayLabel(dayKey(2025, 12, 31), now), '2025年12月31日')
  // 月初的"昨天"必须跨年：不 subtract 而是比较 day 字符串差值时，这条会露出来
  assert.equal(dayLabel(dayKey(2026, 1, 31), local(2026, 2, 1, 0, 30)), '昨天')
})

test('会话时间：分钟级 → 时:分 → 昨天 → 月日 → 年月日', () => {
  const now = local(2026, 9, 20, 12, 0)
  assert.equal(listTime(now - 30_000, now), '刚刚')
  assert.equal(listTime(now - 5 * 60_000, now), '5分钟前')
  assert.equal(listTime(local(2026, 9, 20, 8, 5), now), '08:05')
  assert.equal(listTime(local(2026, 9, 19, 23, 59), now), '昨天')
  assert.equal(listTime(local(2026, 3, 3, 10, 0), now), '3月3日')
  assert.equal(listTime(local(2025, 3, 3, 10, 0), now), '2025年3月3日')
})

test('未来时间不写"负几分钟前"', () => {
  const now = local(2026, 9, 20, 12, 0)
  // 平台时钟与本机有几秒差是常态（spec §9 的 msg_time 异常一条）：列表右侧兜到"刚刚"
  assert.equal(listTime(now + 40_000, now), '刚刚')
})
