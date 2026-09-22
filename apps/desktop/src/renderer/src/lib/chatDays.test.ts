// src/renderer/src/lib/chatDays.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatDayKey } from '../../../shared/chatTime.ts'
import { dayLabel, groupByDay, listTime } from './chatDays.ts'

const row = (ts: number, msgKey: string): { ts: number; msgKey: string } => ({ ts, msgKey })

const CHAT_ZONE_OFFSET_MIN = 480

/**
 * 测试数据按**东八区墙钟**构造，不按机器本地时间：气泡的 `ts` 来自库里那个写死东八区的
 * `msg_time`，而 `groupByDay` / `dayLabel` / `listTime` 的口径就是那个墙钟。用
 * `new Date(y, m, d)` 造数等于把断言的前提交给跑用例的机器——换台非东八区的机器，
 * 数据本身就先挪了天，用例照样绿却什么都没证明。
 */
const sh = (y: number, m: number, d: number, hh = 12, mm = 0): number =>
  Date.UTC(y, m - 1, d, hh - CHAT_ZONE_OFFSET_MIN / 60, mm, 0, 0)

const dayKey = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * 换机器时区跑一遍：见最后那条用例，它是"东八区口径"唯一的反证手段。
 * 恢复要按**名字赋值**，不能 `delete process.env.TZ`：Node 只在 TZ 被赋值时重算偏移，delete 之后
 * 进程仍留在上一个区（本机实测：设成加尔各答再 delete，`getTimezoneOffset()` 还是 -330），
 * 同文件后面的用例就悄悄换了前提。原来没设 TZ 时，先记下机器区名再赋回去——副作用是跑完后 TZ
 * 从"未设"变成"设成同名区"，对 Date 而言两者等价（本机实测偏移同为 -480）。
 */
function withZone<T>(tz: string, read: () => T): T {
  const prev = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  process.env.TZ = tz
  try {
    return read()
  } finally {
    process.env.TZ = prev
  }
}

test('按东八区日切段，段内保持升序', () => {
  const rows = [row(sh(2026, 9, 19, 23, 59), 'a'), row(sh(2026, 9, 20, 0, 1), 'b')]
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
    row(sh(2026, 9, 20, 9), 'c'),
    row(sh(2026, 9, 19, 20), 'a'),
    row(sh(2026, 9, 20, 8), 'b')
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
  const now = sh(2026, 9, 20, 12, 0)
  assert.equal(dayLabel(dayKey(2026, 9, 20), now), '今天')
  assert.equal(dayLabel(dayKey(2026, 9, 19), now), '昨天')
  assert.equal(dayLabel(dayKey(2026, 1, 5), now), '1月5日')
  assert.equal(dayLabel(dayKey(2025, 12, 31), now), '2025年12月31日')
  // 月初的"昨天"必须跨年：不 subtract 而是比较 day 字符串差值时，这条会露出来
  assert.equal(dayLabel(dayKey(2026, 1, 31), sh(2026, 2, 1, 0, 30)), '昨天')
})

test('会话时间：分钟级 → 时:分 → 昨天 → 月日 → 年月日', () => {
  const now = sh(2026, 9, 20, 12, 0)
  assert.equal(listTime(now - 30_000, now), '刚刚')
  assert.equal(listTime(now - 5 * 60_000, now), '5分钟前')
  assert.equal(listTime(sh(2026, 9, 20, 8, 5), now), '08:05')
  assert.equal(listTime(sh(2026, 9, 19, 23, 59), now), '昨天')
  assert.equal(listTime(sh(2026, 3, 3, 10, 0), now), '3月3日')
  assert.equal(listTime(sh(2025, 3, 3, 10, 0), now), '2025年3月3日')
})

test('未来时间不写"负几分钟前"', () => {
  const now = sh(2026, 9, 20, 12, 0)
  // 平台时钟与本机有几秒差是常态（spec §9 的 msg_time 异常一条）：列表右侧兜到"刚刚"
  assert.equal(listTime(now + 40_000, now), '刚刚')
})

test('机器时区不参与口径：换四个区，切段/日头/时刻都还是东八区那一套', () => {
  const now = sh(2026, 9, 20, 12, 0)
  // 东八区日界两侧的毫秒：`justAfterMidnight` 在 UTC 轴上是 9-19 16:01，按浏览器时区格式化
  // 的实现会在这些区里至少错一处（UTC / 纽约把两侧都归到 9-19，Kiritimati 把它们并成 9-20 一段）。
  const justAfterMidnight = sh(2026, 9, 20, 0, 1)
  const justBeforeMidnight = sh(2026, 9, 20, 0, 0) - 1
  // 前提自检：减 1ms 必须真的跨过东八区那条日界，否则这条用例只是在比同一个 day
  assert.equal(chatDayKey(justBeforeMidnight), dayKey(2026, 9, 19))
  assert.equal(chatDayKey(justAfterMidnight), dayKey(2026, 9, 20))
  for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
    withZone(tz, () => {
      assert.deepEqual(
        groupByDay([row(justBeforeMidnight, 'a'), row(justAfterMidnight, 'b')]).map((s) => s.day),
        [dayKey(2026, 9, 19), dayKey(2026, 9, 20)],
        `${tz}：日分组跟了机器时区`
      )
      assert.equal(dayLabel(dayKey(2026, 9, 20), now), '今天', `${tz}：日头跟了机器时区`)
      assert.equal(dayLabel(dayKey(2026, 9, 19), now), '昨天', `${tz}：昨天跟了机器时区`)
      assert.equal(listTime(justAfterMidnight, now), '00:01', `${tz}：时刻跟了机器时区`)
      assert.equal(listTime(justBeforeMidnight, now), '昨天', `${tz}：昨天/时刻分界跟了机器时区`)
    })
  }
})
