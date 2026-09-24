// src/shared/theme.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isThemePref,
  resolveEffectiveTheme,
  windowBackgroundOf,
  WINDOW_BACKGROUND
} from './theme.ts'

test('system 是唯一会读系统偏好的档位，其余两档必须与它无关', () => {
  assert.equal(resolveEffectiveTheme('system', true), 'dark')
  assert.equal(resolveEffectiveTheme('system', false), 'light')
  // 这四条是判据：light/dark 若偷偷串进了系统值，切换顺序就会不稳定。
  assert.equal(resolveEffectiveTheme('light', true), 'light')
  assert.equal(resolveEffectiveTheme('light', false), 'light')
  assert.equal(resolveEffectiveTheme('dark', true), 'dark')
  assert.equal(resolveEffectiveTheme('dark', false), 'dark')
})

test('isThemePref 只采信三个已知字面量，其余一律不认（含 null/undefined/大小写/别名）', () => {
  for (const ok of ['light', 'dark', 'system']) assert.equal(isThemePref(ok), true)
  for (const bad of [
    null,
    undefined,
    '',
    'LIGHT',
    'System',
    'auto',
    'system ',
    0,
    1,
    true,
    {},
    [],
    ['light']
  ]) {
    assert.equal(isThemePref(bad), false, `不该采信 ${JSON.stringify(bad)}`)
  }
})

test('两档各有底色，且互不相同——同色就等于深色档没生效', () => {
  assert.notEqual(WINDOW_BACKGROUND.light, WINDOW_BACKGROUND.dark)
  for (const hex of [windowBackgroundOf('light'), windowBackgroundOf('dark')]) {
    assert.match(hex, /^#[0-9a-f]{6}$/)
  }
})
