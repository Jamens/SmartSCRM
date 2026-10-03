import assert from 'node:assert/strict'
import { SUPPORTED_LOCALES, isLocaleCode, FALLBACK_LOCALE } from './i18n.ts'

const validCodes = SUPPORTED_LOCALES.map((l) => l.code)

for (const code of validCodes) {
  assert.equal(isLocaleCode(code), true, `${code} 应被识别为受支持语种`)
}

assert.equal(isLocaleCode('fr'), false, '未列出的语种应被拒绝')
assert.equal(isLocaleCode('ZH-CN'), false, '大小写敏感，大写不应命中')
assert.equal(isLocaleCode(''), false, '空串不应命中')
assert.equal(isLocaleCode(null), false, '非字符串不应命中')
assert.equal(isLocaleCode(123), false, '数字不应命中')
assert.equal(isLocaleCode(FALLBACK_LOCALE), true, '回退语种本身必须受支持')
assert.equal(validCodes.length, 8, '框架应列满 8 个语种')
