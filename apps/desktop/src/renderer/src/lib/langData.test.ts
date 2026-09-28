// src/renderer/src/lib/langData.test.ts
// 每条线路的下拉只给"该线路真能产出"的语种。反例来自真机：全局档被存成 receiveToLang=lt、
// sendFromLang=af 之后，百度适配器在发请求前就拒（ProviderException）→ 降级分支永不回写永不缓存
// → 内嵌页那颗「点此重试」永远点不亮。所以下拉宁可窄，不能宽。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  allLanguages,
  ENGINE_LANGUAGES,
  isSupportedByChannel,
  languageName,
  sourceLanguagesFor,
  targetLanguagesFor,
  TRANSLATION_CHANNELS
} from './langData.ts'

const codesOf = (langs: { code: string }[]): string[] => [...langs.map((l) => l.code)].sort()

/** 后端适配器的 LANGS 键集 = `supports()` 真正认的那些码。清单只在这里取一次，两处共用。 */
function javaLangs(file: string): string[] {
  const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
  const start = src.indexOf('Map<String, String> LANGS')
  assert.ok(start >= 0, `没在源文件里认出 LANGS：${file}`)
  const block = src.slice(start, src.indexOf(');', start))
  const keys = [...block.matchAll(/"([A-Za-z-]+)"\s*,\s*"[A-Za-z]+"/g)].map((m) => m[1])
  assert.ok(keys.length > 0, `LANGS 解析出 0 个键（源文件形状变了，别把这条当绿）：${file}`)
  return [...new Set(keys)].sort()
}

const BAIDU_JAVA = '../../../../../../apps/server/src/main/java/com/smartscrm/server/service/provider/BaiduProvider.java'
const TENCENT_JAVA = '../../../../../../apps/server/src/main/java/com/smartscrm/server/service/provider/TencentProvider.java'

const SIMULATED = ['1', '2', '3', '4', '6']

test('R4 模拟线路（1/2/3/4/6）的目标语只给引擎产得出的 8 个', () => {
  for (const channel of SIMULATED) {
    assert.deepEqual(codesOf(targetLanguagesFor(channel)), [...ENGINE_LANGUAGES].sort(), `channel ${channel}`)
  }
})

test('R4 线上线路（5 百度 / 7 腾讯）的目标语与各自 LANGS 键集逐码相等', () => {
  assert.deepEqual(codesOf(targetLanguagesFor('5')), javaLangs(BAIDU_JAVA))
  assert.deepEqual(codesOf(targetLanguagesFor('7')), javaLangs(TENCENT_JAVA))
})

test('漂移闸：前端清单与后端 supports() 的真值同批改动才会绿', () => {
  // 单列一条是因为上一条同时读两侧：这条把"两边都恰好 8 个、且都含 zh-CN"写死，
  // 免得某天 Java 侧加了第 9 个码而前端没跟，上一条仍靠巧合通过。
  const baidu = javaLangs(BAIDU_JAVA)
  assert.equal(codesOf(targetLanguagesFor('5')).length, baidu.length)
  assert.ok(baidu.includes('zh-CN') && baidu.includes('en'))
})

test('源语侧不再有独立外观清单：与目标语同集合，自动检测由 allowAuto 提供', () => {
  for (const { code } of TRANSLATION_CHANNELS) {
    assert.deepEqual(codesOf(sourceLanguagesFor(code)), codesOf(targetLanguagesFor(code)), `channel ${code}`)
  }
})

test('收窄是真的收窄了：全量清单远大于任一条线路，且死路码不在下拉里', () => {
  assert.ok(allLanguages.length > targetLanguagesFor('5').length * 5, '下拉没收窄')
  // lt / af 是真机上当天把翻译打进永久降级的两个码；ja、zh-TW 是页面上手就能选到的常见误选。
  for (const dead of ['lt', 'af', 'ja', 'zh-TW']) {
    for (const { code } of TRANSLATION_CHANNELS) {
      assert.ok(!codesOf(targetLanguagesFor(code)).includes(dead), `channel ${code} 仍提供 ${dead}`)
      assert.ok(!codesOf(sourceLanguagesFor(code)).includes(dead), `channel ${code} 源语仍提供 ${dead}`)
    }
  }
})

test('收窄不影响名字字典：线路外存值仍要能被显示出来（兜底项要用）', () => {
  assert.equal(languageName('lt'), '立陶宛语（lt）')
  assert.equal(languageName(''), '自动检测')
})

test('R4 isSupportedByChannel 与下拉同源：提示与兜底项不能各自判一份', () => {
  for (const { code } of TRANSLATION_CHANNELS) {
    for (const lang of targetLanguagesFor(code)) {
      assert.ok(isSupportedByChannel(lang.code, code), `下拉给了 ${lang.code}，提示却说它不支持（channel ${code}）`)
    }
    // 空串两侧都不算支持：目标语未选时线路上确实产不出译文，提示要照常给。
    assert.ok(!isSupportedByChannel('', code), `channel ${code} 把空目标语当成了支持`)
    assert.ok(!isSupportedByChannel('lt', code), `channel ${code} 把 lt 当成了支持`)
  }
})
