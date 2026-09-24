// src/shared/machine.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNKNOWN_TEXT,
  formatBytes,
  machineProfileRows,
  osVersionOf,
  storageUsageText,
  type DeviceExtras,
  type MachineProfile
} from './machine.ts'

/** 一份"每个字段都有值"的样板。逐字段改它，就能只看某一行的反应。 */
function profile(overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    platform: 'win32',
    arch: 'x64',
    release: '10.0.26100',
    electron: '39.8.10',
    chrome: '140.0.7339.240',
    node: '24.0.0',
    appVersion: '0.1.0',
    userData: 'C:/Users/demo/AppData/Roaming/smartscrm-desktop',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    ...overrides
  }
}

const extras = (overrides: Partial<DeviceExtras> = {}): DeviceExtras => ({
  deviceId: 'dev-abc',
  deviceName: 'SmartSCRM Desktop',
  ...overrides
})

const EXPECTED_KEYS = [
  'platform',
  'arch',
  'release',
  'appVersion',
  'deviceId',
  'deviceName',
  'electron',
  'chrome',
  'node',
  'locale',
  'timezone',
  'userData',
  'storage'
]

test('十三行一行不少，顺序就是卡片上的顺序', () => {
  const rows = machineProfileRows(profile(), extras())
  assert.deepEqual(
    rows.map((row) => row.key),
    EXPECTED_KEYS
  )
  // 标签也点名：顺序对了但标签串位，看上去仍然是一台正常的机器。
  const LABELS = [
    '平台',
    '架构',
    '系统版本',
    '应用版本',
    '机器码',
    '设备名',
    'Electron',
    'Chromium',
    'Node',
    '系统语言',
    '时区',
    '本机数据目录',
    '本机数据占用'
  ]
  assert.deepEqual(
    rows.map((row) => row.label),
    LABELS
  )
})

test('每行的值来自它自己的字段，不是从上一行抄过来的', () => {
  const rows = machineProfileRows(profile(), extras())
  const valueOf = (key: string): string | undefined => rows.find((row) => row.key === key)?.value
  assert.equal(valueOf('platform'), 'win32')
  assert.equal(valueOf('arch'), 'x64')
  assert.equal(valueOf('release'), '10.0.26100')
  assert.equal(valueOf('appVersion'), '0.1.0')
  assert.equal(valueOf('deviceId'), 'dev-abc')
  assert.equal(valueOf('deviceName'), 'SmartSCRM Desktop')
  assert.equal(valueOf('electron'), '39.8.10')
  assert.equal(valueOf('chrome'), '140.0.7339.240')
  assert.equal(valueOf('node'), '24.0.0')
  assert.equal(valueOf('locale'), 'zh-CN')
  assert.equal(valueOf('timezone'), 'Asia/Shanghai')
  assert.equal(valueOf('userData'), 'C:/Users/demo/AppData/Roaming/smartscrm-desktop')

  // 只动一个字段：该变的变，其余十一行不动。
  const moved = machineProfileRows(profile({ timezone: 'UTC' }), extras())
  assert.equal(moved.find((row) => row.key === 'timezone')?.value, 'UTC')
  assert.deepEqual(
    moved.filter((row) => row.key !== 'timezone').map((row) => row.value),
    rows.filter((row) => row.key !== 'timezone').map((row) => row.value)
  )
})

test('取不到的字段说「未知」，而且「未知」与空串在界面上必须能区分', () => {
  const rows = machineProfileRows(profile({ locale: '', arch: '   ' }), {
    deviceId: '',
    deviceName: '  '
  })
  assert.equal(rows.find((row) => row.key === 'locale')?.value, UNKNOWN_TEXT)
  assert.equal(rows.find((row) => row.key === 'arch')?.value, UNKNOWN_TEXT)
  assert.equal(rows.find((row) => row.key === 'deviceId')?.value, UNKNOWN_TEXT)
  assert.equal(rows.find((row) => row.key === 'deviceName')?.value, UNKNOWN_TEXT)
  // 这条断言是本模块存在的理由：空串读起来像"没渲染出来"。
  assert.notEqual(rows.find((row) => row.key === 'locale')?.value, '')
  // 没有一行可以是空串。
  assert.deepEqual(
    rows.filter((row) => row.value === '').map((row) => row.key),
    []
  )
})

test('主进程整个没给（undefined / 缺字段 / 非字符串）也不能崩，且照样一行不少', () => {
  for (const bad of [
    undefined,
    null,
    {},
    { platform: 1, arch: null } as unknown as MachineProfile
  ]) {
    const rows = machineProfileRows(bad as MachineProfile, undefined as unknown as DeviceExtras)
    assert.equal(rows.length, EXPECTED_KEYS.length, `${JSON.stringify(bad)} 不该让行消失`)
    assert.deepEqual(
      rows.filter((row) => row.value !== UNKNOWN_TEXT).map((row) => row.key),
      [],
      `${JSON.stringify(bad)} 的每个字段都该落到「未知」`
    )
  }
})

test('osVersionOf 由三个字段拼成，与登录上报和展示共用同一句', () => {
  assert.equal(osVersionOf(profile()), 'win32 10.0.26100 · x64')
  // 缺一个字段时是"局部未知"，不是整句空掉，也不是把 undefined 拼进句子。
  assert.equal(osVersionOf(profile({ release: '' })), `win32 ${UNKNOWN_TEXT} · x64`)
  assert.equal(
    osVersionOf(undefined as unknown as MachineProfile),
    `${UNKNOWN_TEXT} ${UNKNOWN_TEXT} · ${UNKNOWN_TEXT}`
  )
  assert.notEqual(
    osVersionOf(undefined as unknown as MachineProfile),
    'undefined undefined · undefined'
  )
})

test('formatBytes 按 1024 进制，边界值各归各档', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1024), '1.0 TB')
  // 到 TB 封顶，不再造出不存在的单位。
  assert.equal(formatBytes(1024 ** 5), '1024.0 TB')
})

test('占用取不到时说「未知」，不能说 0 B（那是"这个目录是空的"）', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(formatBytes(bad), UNKNOWN_TEXT, `${String(bad)} 不是占用量`)
  }
  assert.equal(formatBytes(undefined as unknown as number), UNKNOWN_TEXT)
  assert.equal(formatBytes('2048' as unknown as number), UNKNOWN_TEXT)
  assert.notEqual(formatBytes(NaN), formatBytes(0))
})

test('占用那一行把字节数和文件数说在一起，空目录与读不到必须是两种写法', () => {
  assert.equal(
    storageUsageText({ bytes: 1536, files: 23, incomplete: false }),
    '1.5 KB · 23 个文件'
  )
  // 「0 个文件」是实测出来的空目录，不是失败。
  assert.equal(storageUsageText({ bytes: 0, files: 0, incomplete: false }), '0 B · 0 个文件')
  for (const bad of [
    undefined,
    null,
    {},
    { bytes: 1536, files: null, incomplete: false },
    { bytes: null, files: 23, incomplete: false },
    { bytes: NaN, files: 3, incomplete: false },
    { bytes: -1, files: 3, incomplete: false },
    { bytes: 100, files: 1.5, incomplete: false },
    { bytes: 100, files: -1, incomplete: false }
  ]) {
    assert.equal(storageUsageText(bad as never), UNKNOWN_TEXT, `${JSON.stringify(bad)} 不是占用量`)
  }
  assert.notEqual(
    storageUsageText({ bytes: 0, files: 0, incomplete: false }),
    storageUsageText({ bytes: null, files: null, incomplete: true })
  )
})

test('没读完时这行数只是下界，界面上要写出「至少」而不是报一个精确值', () => {
  const truncated = storageUsageText({ bytes: 2048, files: 7, incomplete: true })
  const exact = storageUsageText({ bytes: 2048, files: 7, incomplete: false })
  assert.equal(truncated, '至少 2.0 KB · 7 个文件')
  assert.notEqual(truncated, exact, '读完和没读完必须看得出来')
})

test('占用那一条走的是同一张表：extras 里有就说数，没有就「未知」，不影响另外十二行', () => {
  const known = machineProfileRows(
    profile(),
    extras({ storage: { bytes: 1536, files: 23, incomplete: false } })
  )
  const valueOf = (rows: ReturnType<typeof machineProfileRows>, key: string): string | undefined =>
    rows.find((row) => row.key === key)?.value
  assert.equal(valueOf(known, 'storage'), '1.5 KB · 23 个文件')
  const pending = machineProfileRows(profile(), extras())
  assert.equal(valueOf(pending, 'storage'), UNKNOWN_TEXT)
  // 它慢它的，取不到不该把整张卡片一起拖成未知。
  assert.deepEqual(
    pending.filter((row) => row.key !== 'storage').map((row) => row.value),
    known.filter((row) => row.key !== 'storage').map((row) => row.value)
  )
})
