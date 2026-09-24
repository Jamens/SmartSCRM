// src/shared/badge.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { badgeCountOf, sanitizeBadgeCount } from './badge.ts'

test('聚焦必须把角标压成 0，且与失焦时的结果不同（相同就是这条规则根本没生效）', () => {
  const unfocused = badgeCountOf({ enabled: true, focused: false, total: 7 })
  const focused = badgeCountOf({ enabled: true, focused: true, total: 7 })
  assert.equal(unfocused, 7)
  assert.equal(focused, 0)
  assert.notEqual(unfocused, focused)
})

test('开关关掉报 0，且与开着时不同', () => {
  const on = badgeCountOf({ enabled: true, focused: false, total: 12 })
  const off = badgeCountOf({ enabled: false, focused: false, total: 12 })
  assert.equal(on, 12)
  assert.equal(off, 0)
  assert.notEqual(on, off)
  // 开关与聚焦同时命中也还是 0：两条闸是"与"的关系，不互相顶掉。
  assert.equal(badgeCountOf({ enabled: false, focused: true, total: 12 }), 0)
})

test('还没取到数与真的没有未读都报 0，但都不给 NaN/null', () => {
  assert.equal(badgeCountOf({ enabled: true, focused: false, total: null }), 0)
  assert.equal(badgeCountOf({ enabled: true, focused: false, total: 0 }), 0)
})

test('sanitizeBadgeCount 只交给 Electron 一个非负整数', () => {
  assert.equal(sanitizeBadgeCount(7), 7)
  assert.equal(sanitizeBadgeCount(7.9), 7)
  assert.equal(sanitizeBadgeCount(0.4), 0)
  assert.equal(sanitizeBadgeCount(-3), 0)
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(sanitizeBadgeCount(bad), 0, `非有限数 ${String(bad)} 会直接把 setBadgeCount 打崩`)
  }
  for (const notNumber of ['7', null, undefined, true, {}, [], ['7']]) {
    assert.equal(sanitizeBadgeCount(notNumber), 0, `不该把 ${JSON.stringify(notNumber)} 当成计数`)
  }
})
