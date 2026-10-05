// src/shared/update.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  disabledVerdict,
  isNewerVersion,
  parseUpdateManifest,
  verdictFrom
} from './update.ts'

test('parseUpdateManifest accepts a well-formed manifest', () => {
  const m = parseUpdateManifest({ version: '1.2.3', downloadUrl: 'https://x/p.exe', notes: 'fix' })
  assert.equal(m?.version, '1.2.3')
  assert.equal(m?.downloadUrl, 'https://x/p.exe')
  assert.equal(m?.notes, 'fix')
})

test('parseUpdateManifest rejects missing/invalid fields → null', () => {
  assert.equal(parseUpdateManifest(null), null)
  assert.equal(parseUpdateManifest('x'), null)
  assert.equal(parseUpdateManifest({ version: '1.0.0' }), null) // no downloadUrl
  assert.equal(parseUpdateManifest({ downloadUrl: 'u' }), null) // no version
  assert.equal(parseUpdateManifest({ version: '  ', downloadUrl: 'u' }), null) // blank version
})

test('isNewerVersion compares dotted numeric versions', () => {
  assert.equal(isNewerVersion('1.2.4', '1.2.3'), true)
  assert.equal(isNewerVersion('1.3.0', '1.2.9'), true)
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true)
  assert.equal(isNewerVersion('1.2.3', '1.2.3'), false)
  assert.equal(isNewerVersion('1.2.3', '1.2.4'), false)
  assert.equal(isNewerVersion('1.2', '1.2.0'), false) // missing segment = 0
})

test('isNewerVersion is conservative on prerelease/non-numeric', () => {
  assert.equal(isNewerVersion('1.2.3-beta', '1.2.3'), false)
  assert.equal(isNewerVersion('1.2.3', '1.2.3-beta'), false)
  assert.equal(isNewerVersion('abc', '1.0.0'), false)
})

test('verdictFrom: available / uptodate / invalid', () => {
  const cur = '1.0.0'
  const avail = verdictFrom({ version: '1.1.0', downloadUrl: 'u', notes: null, sha256: null }, cur)
  assert.equal(avail.status, 'available')
  assert.equal(avail.latest, '1.1.0')
  assert.equal(avail.downloadUrl, 'u')

  const same = verdictFrom({ version: '1.0.0', downloadUrl: 'u', notes: null, sha256: null }, cur)
  assert.equal(same.status, 'uptodate')

  const bad = verdictFrom(null, cur)
  assert.equal(bad.status, 'error')
})

test('disabledVerdict is the no-source default (no external call)', () => {
  const v = disabledVerdict('1.0.0')
  assert.equal(v.status, 'disabled')
  assert.equal(v.downloadUrl, null)
})
