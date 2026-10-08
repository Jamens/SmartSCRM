// src/renderer/src/lib/accountDeleteCopy.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { IMPACT_ROW_KEYS } from './accountImpact.ts'
import { zhCN } from '../i18n/locales/zh-CN.ts'
import { en } from '../i18n/locales/en.ts'
import { zhTW } from '../i18n/locales/zh-TW.ts'
import { ja } from '../i18n/locales/ja.ts'
import { ko } from '../i18n/locales/ko.ts'
import { vi } from '../i18n/locales/vi.ts'
import { id } from '../i18n/locales/id.ts'
import { th } from '../i18n/locales/th.ts'

/**
 * 删除确认弹层的文案闸门。
 *
 * `DeepString<typeof zhCN>` 已经保证了八个语言包的**键结构**一致，所以这里补的是它看不见的两件事：
 * 一是 `t('account.delete.' + row.key)` 这种把键拼在字符串里的动态寻址——编译期只会看到 string，
 * 少一个行的文案要等到弹层上直接显示成键名才发现；二是插值占位符，译文把 `{{num}}` 写丢照样是
 * 合法字符串，结果是「影响条数提示」一条数字都不出——少报比不报更危险。
 */
const LOCALES: ReadonlyArray<[code: string, deleteBlock: Record<string, string>]> = [
  ['zh-CN', zhCN.account.delete],
  ['en', en.account.delete],
  ['zh-TW', zhTW.account.delete],
  ['ja', ja.account.delete],
  ['ko', ko.account.delete],
  ['vi', vi.account.delete],
  ['id', id.account.delete],
  ['th', th.account.delete]
]

/** 弹层直接写死取用的键（非行键）。 */
const STATIC_KEYS = ['title', 'desc', 'loading', 'failed', 'empty', 'yes', 'no', 'failedDelete'] as const

const rowKeys: string[] = [...IMPACT_ROW_KEYS]

test('八个语言包都有删除弹层的固定文案，且不是空串', () => {
  for (const [code, block] of LOCALES) {
    for (const key of STATIC_KEYS) {
      const value = block[key]
      assert.equal(typeof value, 'string', `${code} account.delete.${key} 缺失`)
      assert.notEqual(value.trim(), '', `${code} account.delete.${key} 是空串`)
    }
  }
})

test('每个语言包都备齐了五张连带表的行文案', () => {
  for (const [code, block] of LOCALES) {
    for (const key of rowKeys) {
      const value = block[key]
      assert.equal(typeof value, 'string', `${code} account.delete.${key} 缺失：弹层会把键名直接显示出来`)
      assert.notEqual(value.trim(), '', `${code} account.delete.${key} 是空串`)
    }
  }
})

test('行文案都带着 {{num}}，条数不会因为译文而凭空消失', () => {
  for (const [code, block] of LOCALES) {
    for (const key of rowKeys) {
      assert.match(
        block[key] ?? '',
        /\{\{num\}\}/,
        `${code} account.delete.${key} 没有 {{num}}，那一行的条数不会渲染`
      )
    }
  }
})

test('账号名与失败原文有落点：desc 带 {{name}}、failedDelete 带 {{msg}}', () => {
  for (const [code, block] of LOCALES) {
    assert.match(block.desc ?? '', /\{\{name\}\}/, `${code} account.delete.desc 没有 {{name}}`)
    assert.match(block.failedDelete ?? '', /\{\{msg\}\}/, `${code} account.delete.failedDelete 没有 {{msg}}`)
  }
})

test('语言包一个都不少：八种界面语种全在闸门里', () => {
  assert.deepEqual(
    LOCALES.map(([code]) => code),
    ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'vi', 'id', 'th']
  )
})
