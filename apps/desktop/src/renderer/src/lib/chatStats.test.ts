// src/renderer/src/lib/chatStats.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAR_DAYS, shareOf, toBars, type DayCountShape } from './chatStats.ts'

const day = (d: string, inCount: number, outCount: number): DayCountShape => ({ day: d, inCount, outCount })

test('days=30 也只画最近 7 根，保持时间正序、最后一根是窗口末尾', () => {
  const perDay: DayCountShape[] = Array.from({ length: 30 }, (_, i) =>
    day(`2026-09-${String(i + 1).padStart(2, '0')}`, (i % 5) + 1, i % 3)
  )
  const bars = toBars(perDay, 30)
  assert.equal(bars.length, BAR_DAYS)
  assert.equal(bars[bars.length - 1].day, '2026-09-30')
  assert.deepEqual(bars.map((b) => b.day).slice(0, 2), ['2026-09-24', '2026-09-25'])
  assert.equal(bars[0].label, '9/24')
})

test('归一：最大那根 100%、其余按比例；柱内收发两段正好铺满一根', () => {
  const bars = toBars([day('2026-09-18', 10, 10), day('2026-09-19', 3, 1), day('2026-09-20', 5, 5)])
  assert.deepEqual(bars.map((b) => b.heightPct), [100, 20, 50])
  assert.equal(bars[1].total, 4)
  assert.equal(bars[1].inShare, 75)
  assert.equal(bars[1].inShare + bars[1].outShare, 100)
})

test('全零窗口：0 高度、0 占比，不出现 NaN / Infinity / 负数', () => {
  const bars = toBars([day('2026-09-19', 0, 0), day('2026-09-20', 0, 0)])
  assert.deepEqual(bars.map((b) => b.heightPct), [0, 0])
  assert.deepEqual(bars.map((b) => [b.inShare, b.outShare]), [[0, 0], [0, 0]])
  for (const b of bars) {
    assert.ok(Number.isFinite(b.heightPct) && b.heightPct >= 0)
  }
})

test('后端漏了某天就少画几根：客户端不再补第二份零', () => {
  assert.equal(toBars([day('2026-09-20', 1, 0)], 7).length, 1)
  assert.equal(toBars([], 7).length, 0)
  assert.equal(shareOf(0, 0), '—')
  assert.equal(shareOf(3, 7), '43%')
  assert.equal(shareOf(7, 7), '100%')
})
