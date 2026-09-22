// src/shared/chatTime.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_ZONE_OFFSET_MIN,
  CHAT_ZONE_OFFSET_TAG,
  chatClock,
  chatDayBefore,
  chatDayKey,
  chatDayParts
} from './chatTime.ts'

/**
 * 把 instant 摆到某个机器时区里读一遍，用来证明"日界与时刻不跟机器时区走"。
 * 断言必须在这里换区：本机是东八区，不换区的话"按浏览器时区格式化"的错实现和正确实现
 * 跑出来一模一样，这条用例就成了永真的摆设。
 */
function withZone<T>(tz: string, read: () => T): T {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    return read()
  } finally {
    // 原来是没设过 TZ 的：必须 delete，赋 `undefined` 会被 Node 存成字符串 "undefined"，
    // 之后所有 Date 都按 UTC 走，同文件后面的用例就悄悄换了前提。
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

const ZONES = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Kiritimati'] as const

const DAY_MS = 86_400_000

/** 东八区墙钟 → instant（库里的 `msg_time` 就是这个墙钟，不带偏移）。 */
const sh = (y: number, m: number, d: number, hh = 12, mm = 0): number =>
  Date.UTC(y, m - 1, d, hh - CHAT_ZONE_OFFSET_MIN / 60, mm, 0, 0)

test('偏移常量自洽：串用的标签与算用的分钟数是同一个东八区', () => {
  assert.equal(CHAT_ZONE_OFFSET_MIN, 480)
  assert.equal(CHAT_ZONE_OFFSET_TAG, '+08:00')
  // 标签与分钟数各写一份时，改一处就会静默分叉：这里把两份对上
  const [h, mi] = CHAT_ZONE_OFFSET_TAG.slice(1).split(':').map(Number)
  assert.equal(h * 60 + mi, CHAT_ZONE_OFFSET_MIN)
  assert.ok(CHAT_ZONE_OFFSET_TAG.startsWith('+'))
})

test('日键与时刻按东八区算，机器时区换四个都不受影响', () => {
  // 2026-09-20 00:01 +08 = 2026-09-19 16:01 UTC：UTC 轴上是前一天，纽约更早
  const justAfterMidnight = sh(2026, 9, 20, 0, 1)
  for (const tz of ZONES) {
    assert.equal(chatDayKey(justAfterMidnight), '2026-09-20', `${tz} 下日键错了`)
    assert.equal(chatClock(justAfterMidnight), '00:01', `${tz} 下时刻错了`)
  }
  // 反事实锚点：这条 instant 在 UTC/纽约的本地日历上确实是 9-19，
  // 所以"按浏览器时区格式化"的实现只会红在这里，不会两条都绿。
  assert.equal(new Date(justAfterMidnight).getUTCDate(), 19)
  assert.equal(
    withZone('America/New_York', () => new Date(justAfterMidnight).getDate()),
    19
  )
})

test('日界两侧各归一天：23:59:59.999 与次日 00:00:00 不同段', () => {
  const lastMsOfDay = sh(2026, 9, 20, 0, 0) - 1
  const firstMsOfNext = sh(2026, 9, 20, 0, 0)
  assert.equal(chatDayKey(lastMsOfDay), '2026-09-19')
  assert.equal(chatDayKey(firstMsOfNext), '2026-09-20')
  assert.equal(chatClock(firstMsOfNext), '00:00')
  assert.equal(chatClock(sh(2026, 9, 20, 23, 59)), '23:59')
})

test('chatDayParts 拆日键给文案用（比较年份、拼月日都靠它）', () => {
  assert.deepEqual(chatDayParts('2026-09-20'), { year: 2026, month: 9, day: 20 })
  assert.deepEqual(chatDayParts('2025-12-31'), { year: 2025, month: 12, day: 31 })
  // 拆出来必须是数：文案侧 `${month}月` 不能带前导零
  assert.equal(`${chatDayParts('2026-01-05').month}月${chatDayParts('2026-01-05').day}日`, '1月5日')
})

test('chatDayBefore 按日历日回退，跨月跨年不靠减法凑', () => {
  assert.equal(chatDayBefore('2026-09-20'), '2026-09-19')
  assert.equal(chatDayBefore('2026-09-01'), '2026-08-31')
  assert.equal(chatDayBefore('2026-01-01'), '2025-12-31')
  // 闰年：2026 不是闰年，2 月只到 28 日；2024 是
  assert.equal(chatDayBefore('2026-03-01'), '2026-02-28')
  assert.equal(chatDayBefore('2024-03-01'), '2024-02-29')
  for (const tz of ZONES) {
    assert.equal(withZone(tz, () => chatDayBefore('2026-03-01')), '2026-02-28', `${tz} 下错了`)
  }
  // 回退一天必须正好是 24 小时的日历距离，不然"昨天"文案会跳日
  assert.equal(
    Date.parse('2026-09-20T00:00:00Z') - Date.parse('2026-09-19T00:00:00Z'),
    DAY_MS
  )
})
