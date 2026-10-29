// src/main/services/fingerprint/applier.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WebContents } from 'electron'
import { applyFingerprint, buildFingerprintSource } from './applier.ts'
import type { FingerprintRuntime } from '../../../shared/fingerprint.ts'

const BUNDLE = 'window.__FP__=1;'

interface Call {
  method: string
  args: unknown[]
}

/**
 * 只实现 applier 真正用到的口子：`session.setUserAgent` / `debugger.attach` / `debugger.sendCommand`
 * 外加引导装载要用的 `getURL` / `loadURL` / `dom-ready`。
 *
 * `getURL()` 空字符串 = 从未导航过（实测本机 Electron 39 的取值）；`loadURL` 异步派发一次
 * `dom-ready`，与真实装载同口径。
 */
function fakeWc(failOn?: string, failAttach = false, opts: { initialUrl?: string; load?: boolean } = {}): {
  calls: Call[]
  wc: WebContents
} {
  const calls: Call[] = []
  let attached = false
  let url = opts.initialUrl ?? ''
  const listeners = new Map<string, ((...a: unknown[]) => void)[]>()
  const emit = (ev: string): void => {
    for (const fn of [...(listeners.get(ev) ?? [])]) fn()
  }
  const wc = {
    getURL: (): string => url,
    on: (ev: string, fn: (...a: unknown[]) => void): typeof wc => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), fn])
      return wc
    },
    once: (ev: string, fn: (...a: unknown[]) => void): typeof wc => wc.on(ev, fn),
    removeListener: (ev: string, fn: (...a: unknown[]) => void): typeof wc => {
      listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== fn))
      return wc
    },
    loadURL: (next: string): void => {
      calls.push({ method: 'loadURL', args: [next] })
      url = next
      if (opts.load !== false) setTimeout(() => emit('dom-ready'), 0)
    },
    session: {
      setUserAgent: (...args: unknown[]): void => {
        calls.push({ method: 'setUserAgent', args })
      }
    },
    debugger: {
      isAttached: (): boolean => attached,
      attach: async (version: string): Promise<void> => {
        calls.push({ method: 'attach', args: [version] })
        if (failAttach) throw new Error('attach 炸了')
        attached = true
      },
      detach: async (): Promise<void> => {
        attached = false
        calls.push({ method: 'detach', args: [] })
      },
      sendCommand: async (method: string, params?: unknown): Promise<unknown> => {
        calls.push({ method: 'sendCommand', args: [method, params] })
        if (failOn && method === failOn) throw new Error('CDP 炸了')
        return {}
      }
    }
  }
  return { calls, wc: wc as unknown as WebContents }
}

function runtime(over: Partial<FingerprintRuntime> = {}): FingerprintRuntime {
  return {
    profileId: 11,
    seed: 424242,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
    uaPlatform: 'Windows',
    uaPlatformVersion: '15.0.0',
    brands: [{ brand: 'Chromium', version: '140' }],
    locale: 'en-US',
    timezone: 'America/New_York',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA)',
    canvasNoiseSeed: 3146166556,
    audioNoiseSeed: 2236327244,
    toggles: {},
    ...over
  }
}

const methods = (calls: Call[], name: string): Call[] => calls.filter((c) => c.method === name)
/** sendCommand 的调用顺序：`Page.enable`、`Page.addScriptToEvaluateOnNewDocument`…… */
const sentMethods = (calls: Call[]): string[] => methods(calls, 'sendCommand').map((c) => String(c.args[0]))

test('Page.enable 必须排在 addScriptToEvaluateOnNewDocument 之前（回归哨兵）', async () => {
  // 实测：不发 Page.enable 时，那条命令同样回成功，但脚本一次都不跑——静默失效，
  // 调用方拿到的是"施加成功"。这一条把顺序钉死，别让它以后被当成多余的一步删掉。
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime(), BUNDLE)
  const order = sentMethods(calls)
  const atEnable = order.indexOf('Page.enable')
  const atScript = order.indexOf('Page.addScriptToEvaluateOnNewDocument')
  assert.ok(atEnable >= 0, '应当发出 Page.enable')
  assert.ok(atScript >= 0, '应当发出文档前脚本')
  assert.ok(atEnable < atScript, `顺序应为 enable → addScript，实际 ${order.join(' → ')}`)
})

test('没有脚本可发 → 不发 Page.enable（只为需要的东西 enable）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime({ timezone: undefined }), '')
  assert.equal(sentMethods(calls).includes('Page.enable'), false)
})

test('未导航过的视图 → 先引导一次 about:blank，再 attach（CDP target 的前提）', async () => {
  // 实测：从未导航过的视图上 attach 会成功，但之后每条 CDP 命令都不返回（永久挂住，不抛错）。
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime(), BUNDLE)
  const loads = methods(calls, 'loadURL')
  assert.deepEqual(
    loads.map((c) => c.args[0]),
    ['about:blank'],
    '只多这一次导航，且只用空白文档'
  )
  const atLoad = calls.findIndex((c) => c.method === 'loadURL')
  const atAttach = calls.findIndex((c) => c.method === 'attach')
  assert.ok(atLoad >= 0 && atAttach > atLoad, '引导装载必须排在 attach 之前')
})

test('已导航过的视图（换绑路径）→ 不再引导装载，也不顶掉当前页面', async () => {
  const { calls, wc } = fakeWc(undefined, false, { initialUrl: 'https://web.example.com/' })
  await applyFingerprint(wc, runtime(), BUNDLE)
  assert.equal(methods(calls, 'loadURL').length, 0, '换绑时盯着的是当前那一页，不能被 about:blank 顶掉')
  assert.equal(methods(calls, 'attach').length, 1)
})

test('引导装载不来 → 降级为不施加，且一条 CDP 命令都不发（不能挂死）', async () => {
  // dom-ready 永不到来时，attach 之后每条命令都会永久挂住；宁可降级，也不能让 await 卡住装载。
  const { calls, wc } = fakeWc(undefined, false, { load: false })
  const res = await applyFingerprint(wc, runtime(), BUNDLE)
  assert.ok(res.error?.includes('CDP target'), `降级原因要留在 error 里，实际 ${res.error}`)
  assert.equal(methods(calls, 'attach').length, 0, 'target 不可用时不 attach')
  assert.equal(methods(calls, 'sendCommand').length, 0, 'target 不可用时不发任何命令')
  // UA 是会话级的、不依赖 debugger：它照常生效。
  assert.deepEqual(res.applied, ['navigator'])
})

test('userAgent 为空 → 不调 setUserAgent（缺项不改，R7）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime({ userAgent: undefined }), BUNDLE)
  assert.equal(methods(calls, 'setUserAgent').length, 0)
})

test('locale 为空 → setUserAgent 只收到一个参数（传 undefined 会清掉 Accept-Language）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime({ locale: undefined }), BUNDLE)
  const call = methods(calls, 'setUserAgent')[0]
  assert.ok(call)
  assert.equal(call.args.length, 1)
})

test('timezone 为空且没有脚本 → 不 attach debugger（R6：只为需要的东西 attach）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime({ timezone: undefined }), '')
  assert.equal(methods(calls, 'attach').length, 0)
})

test('timezone 为空但有脚本 → attach 一次（文档前脚本同样走 CDP）', async () => {
  const { calls, wc } = fakeWc()
  const res = await applyFingerprint(wc, runtime({ timezone: undefined }), BUNDLE)
  assert.equal(methods(calls, 'attach').length, 1, '两个 CDP 步骤共用一次 attach')
  assert.ok(res.applied.includes('canvas'))
  assert.ok(!res.applied.includes('timezone'))
})

test('timezone 有值 → attach 一次且 sendCommand 收到 Emulation.setTimezoneOverride', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime(), BUNDLE)
  assert.equal(methods(calls, 'attach').length, 1, '时区 + 脚本两步，attach 只能发生一次')
  const tz = methods(calls, 'sendCommand').find((c) => c.args[0] === 'Emulation.setTimezoneOverride')
  assert.ok(tz, '应发出时区覆盖命令')
  assert.deepEqual(tz.args[1], { timezoneId: 'America/New_York' })
})

test('attach 之后没有 detach（R6 回归哨兵：detach 会把时区重置回系统值）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime(), BUNDLE)
  assert.ok(methods(calls, 'attach').length >= 1)
  assert.equal(methods(calls, 'detach').length, 0)
})

test('attach 失败 → 时区与脚本都不施加，error 有值且不抛', async () => {
  const { wc } = fakeWc(undefined, true)
  const res = await applyFingerprint(wc, runtime(), BUNDLE)
  assert.ok(res.error, '失败要留在 error 里，不能静默吞掉')
  assert.ok(!res.applied.includes('timezone'), 'attach 失败 → 时区不施加')
  assert.ok(!res.applied.includes('canvas'), 'attach 失败 → 文档前脚本不施加（不降级为 did-navigate）')
  // UA 是会话级的，不依赖 debugger：它照常生效，这一项不算失败。
  assert.deepEqual(res.applied, ['navigator'])
  assert.equal(res.skipped.length, 7)
})

test('关掉 canvas → 产出的脚本里不含 canvasNoiseSeed（R9 不留空跑）', async () => {
  const rt = runtime({ toggles: { canvas: false } })
  const source = buildFingerprintSource(rt, BUNDLE)
  assert.ok(!source.includes('canvasNoiseSeed'), '关掉的项连种子都不该出现在配置里')
  assert.ok(source.includes('audioNoiseSeed'), '没关的项照常带种子')

  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, rt, BUNDLE)
  const injected = methods(calls, 'sendCommand').find((c) => c.args[0] === 'Page.addScriptToEvaluateOnNewDocument')
  assert.ok(injected)
  assert.ok(!String((injected.args[1] as { source: string }).source).includes('canvasNoiseSeed'))
})

test('runtime 为 null → 三个方法全没被调用（R9 不留空跑）', async () => {
  const { calls, wc } = fakeWc()
  const res = await applyFingerprint(wc, null, BUNDLE)
  assert.deepEqual(calls, [], '未绑档案 / 全局关 = 一个口子都不碰')
  assert.deepEqual(res.applied, [])
  assert.equal(res.skipped.length, 8)
})

test('sendCommand 抛错 → error 有值、不抛出、后续步骤继续', async () => {
  const { calls, wc } = fakeWc('Emulation.setTimezoneOverride')
  const res = await applyFingerprint(wc, runtime(), BUNDLE)
  assert.ok(res.error, '失败落在 error 里')
  assert.ok(res.error.includes('时区覆盖失败'))
  const injected = methods(calls, 'sendCommand').find((c) => c.args[0] === 'Page.addScriptToEvaluateOnNewDocument')
  assert.ok(injected, '时区那一步炸了，文档前脚本照样要注册——不降级为 did-navigate 注入')
  assert.ok(!res.applied.includes('timezone'))
  assert.ok(res.applied.includes('canvas'))
})

test('关掉 navigator → 不调 setUserAgent（关掉的项不留空跑）', async () => {
  const { calls, wc } = fakeWc()
  await applyFingerprint(wc, runtime({ toggles: { navigator: false } }), BUNDLE)
  assert.equal(methods(calls, 'setUserAgent').length, 0)
  const injected = methods(calls, 'sendCommand').find((c) => c.args[0] === 'Page.addScriptToEvaluateOnNewDocument')
  assert.ok(injected)
  assert.ok(!String((injected.args[1] as { source: string }).source).includes('hardwareConcurrency'))
})

test('全部开关关闭 → 没有任何 CDP 调用', async () => {
  const { calls, wc } = fakeWc()
  const toggles = { navigator: false, canvas: false, webgl: false, audio: false, font: false, mediaDevices: false, iframe: false, timezone: false }
  const res = await applyFingerprint(wc, runtime({ toggles }), BUNDLE)
  assert.deepEqual(calls, [], '全关 = 一个口子都不碰（R9）')
  assert.deepEqual(res.applied, [])
})
