// src/fingerprint/fingerprint.test.ts
/**
 * 页内指纹脚本的单测。Node 里没有 DOM，所以被测的都是 `installAll(cfg, env)`：
 * env 里塞的是 stub 原型/实例，跑的是与生产完全相同的 install 逻辑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installAll } from './index.ts'
import { FP_TOGGLE_KEYS } from '../shared/fingerprint.ts'
import type { FingerprintRuntime, FpToggleKey } from '../shared/fingerprint.ts'
import type { FpEnv } from './types.ts'

// ---------------------------------------------------------------- stub DOM

class StubDoc {
  createElement(): StubCanvas {
    return new StubCanvas(0, 0, this)
  }
}

class StubCtx {
  canvas: StubCanvas
  pixels: Uint8ClampedArray
  font = '10px sans-serif'

  constructor(canvas: StubCanvas) {
    this.canvas = canvas
    this.pixels = canvas.pixels
  }
  getImageData(
    _x: number,
    _y: number,
    w: number,
    h: number
  ): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(this.pixels), width: w, height: h }
  }
  putImageData(img: { data: Uint8ClampedArray }): void {
    this.pixels.set(img.data)
  }
  drawImage(src: StubCanvas): void {
    this.pixels.set(src.pixels)
  }
  measureText(text: string): Record<string, number> {
    return { width: text.length * 8 }
  }
}

class StubCanvas {
  width: number
  height: number
  pixels: Uint8ClampedArray
  ownerDocument: StubDoc
  ctx: StubCtx | null = null

  constructor(w: number, h: number, doc: StubDoc = new StubDoc()) {
    this.width = w
    this.height = h
    this.pixels = new Uint8ClampedArray(w * h * 4)
    this.ownerDocument = doc
  }
  getContext(): StubCtx {
    const need = this.width * this.height * 4
    if (this.pixels.length !== need) {
      this.pixels = new Uint8ClampedArray(need)
      this.ctx = null
    }
    if (!this.ctx) this.ctx = new StubCtx(this)
    return this.ctx
  }
  toDataURL(): string {
    return 'data:image/png;base64,' + Buffer.from(this.pixels).toString('base64')
  }
}

interface Harness {
  env: FpEnv
  nav: Record<string, unknown>
  navProto: Record<string, unknown>
  canvas: StubCanvas
  webgl: Record<string, unknown>
  audio: Record<string, unknown>
}

const REAL_HARDWARE_CONCURRENCY = 8

function makeHarness(): Harness {
  const nav: Record<string, unknown> = {
    hardwareConcurrency: REAL_HARDWARE_CONCURRENCY,
    deviceMemory: 4,
    platform: 'RealPlatform',
    vendor: 'RealVendor',
    languages: ['en-US'],
    mediaDevices: { enumerateDevices: (): Promise<unknown> => Promise.resolve([]) }
  }
  const navProto: Record<string, unknown> = {}
  const canvas = new StubCanvas(2, 1)
  canvas.pixels.set([10, 20, 30, 255, 40, 50, 60, 255])
  const webgl: Record<string, unknown> = {
    getParameter: (pname: number): unknown => (pname === 0x1f01 ? 'RealGPU' : 'RealVendor')
  }
  const audio: Record<string, unknown> = {
    getChannelData: (): Float32Array => new Float32Array([0.5, -0.25, 0.125])
  }
  const env: FpEnv = {
    navigator: nav,
    navigatorProto: navProto,
    canvasEl: StubCanvas.prototype as unknown as Record<string, unknown>,
    canvasCtx: StubCtx.prototype as unknown as Record<string, unknown>,
    webgl: [webgl],
    audioBuffer: audio,
    document: new StubDoc() as unknown as Record<string, unknown>,
    window: {}
  }
  return { env, nav, navProto, canvas, webgl, audio }
}

function cfgWith(extra: Partial<FingerprintRuntime>): Partial<FingerprintRuntime> {
  return { seed: 20261028, toggles: {}, ...extra }
}

function allOff(): Partial<Record<FpToggleKey, boolean>> {
  const t: Partial<Record<FpToggleKey, boolean>> = {}
  for (const k of FP_TOGGLE_KEYS) t[k] = false
  return t
}

const RAW = {
  toDataURL: StubCanvas.prototype.toDataURL,
  getImageData: StubCtx.prototype.getImageData,
  measureText: StubCtx.prototype.measureText
}

/** 把 hook 还原：类原型上的覆盖会跨用例留存，不还原的话后一个用例测的是前一个的残留。 */
function restorePrototypes(): void {
  const put = (proto: object, prop: string, value: unknown): void => {
    Object.defineProperty(proto, prop, {
      value,
      writable: true,
      configurable: true,
      enumerable: false
    })
  }
  put(StubCanvas.prototype, 'toDataURL', RAW.toDataURL)
  put(StubCtx.prototype, 'getImageData', RAW.getImageData)
  put(StubCtx.prototype, 'measureText', RAW.measureText)
}

// ---------------------------------------------------------------- 用例

test('navigator：hardwareConcurrency 被覆盖成配置值', () => {
  const h = makeHarness()
  installAll(cfgWith({ hardwareConcurrency: 12 }), h.env)
  assert.equal(h.nav.hardwareConcurrency, 12)
  // 原型那一份也要盖上：只读 getter 只盖实例挡不住 `Navigator.prototype` 上的读取路径。
  assert.equal(h.navProto.hardwareConcurrency, 12)
  restorePrototypes()
})

test('配置缺 hardwareConcurrency：原值保持不动（R7 缺项不改）', () => {
  const h = makeHarness()
  installAll(cfgWith({ deviceMemory: 16 }), h.env)
  assert.equal(h.nav.hardwareConcurrency, REAL_HARDWARE_CONCURRENCY)
  assert.equal(h.nav.platform, 'RealPlatform')
  assert.equal(h.nav.deviceMemory, 16)
  restorePrototypes()
})

test('canvas：toDataURL 两次结果相同，且与未 hook 时的基线不同', () => {
  const h = makeHarness()
  const baseline = h.canvas.toDataURL()
  installAll(cfgWith({ canvasNoiseSeed: 4242 }), h.env)
  const first = h.canvas.toDataURL()
  const second = h.canvas.toDataURL()
  assert.equal(first, second, '同 seed 必须稳定：连调两次给出两张图 = 自曝')
  assert.notEqual(first, baseline, '与基线一致 = 噪声根本没生效')
  restorePrototypes()
})

test('canvas 关闭：toDataURL 与基线完全一致（R9）', () => {
  const h = makeHarness()
  const baseline = h.canvas.toDataURL()
  installAll(cfgWith({ canvasNoiseSeed: 4242, toggles: { canvas: false } }), h.env)
  assert.equal(h.canvas.toDataURL(), baseline)
  restorePrototypes()
})

test('canvas：getImageData 的像素被加了噪声，且两次一致', () => {
  const h = makeHarness()
  installAll(cfgWith({ canvasNoiseSeed: 99 }), h.env)
  const ctx = h.canvas.getContext()
  const a = Array.from(ctx.getImageData(0, 0, 2, 1).data)
  const b = Array.from(ctx.getImageData(0, 0, 2, 1).data)
  assert.deepEqual(a, b)
  // 原始像素前三个通道每像素 ±1，alpha 不动。
  assert.notDeepEqual(a, [10, 20, 30, 255, 40, 50, 60, 255])
  assert.equal(a[3], 255)
  assert.equal(a[7], 255)
  restorePrototypes()
})

test('webgl：getParameter(RENDERER) 返回配置值', () => {
  const h = makeHarness()
  installAll(cfgWith({ webglVendor: 'FakeVendor', webglRenderer: 'FakeGPU' }), h.env)
  const getParameter = h.webgl.getParameter as (p: number) => unknown
  assert.equal(getParameter(0x1f01), 'FakeGPU')
  assert.equal(getParameter(0x9246), 'FakeGPU', 'unmasked 常量：指纹脚本真正读的是这个')
  assert.equal(getParameter(0x1f00), 'FakeVendor')
  assert.equal(getParameter(0x0d33), 'RealVendor', '未涉及的常量照原样走（stub 的默认返回值）')
  restorePrototypes()
})

test('audio：采样扰动幅度 ≤1e-6 且连读两次一致', () => {
  const h = makeHarness()
  installAll(cfgWith({ audioNoiseSeed: 7 }), h.env)
  const getChannelData = h.audio.getChannelData as () => Float32Array
  const a = getChannelData()
  const b = getChannelData()
  const deltas = [a[0] - 0.5, a[1] + 0.25, a[2] - 0.125]
  assert.ok(
    deltas.every((d) => Math.abs(d) <= 1e-6),
    `幅度超了：${deltas.join(',')}`
  )
  assert.ok(
    deltas.some((d) => d !== 0),
    '全是 0 = 扰动没生效'
  )
  assert.deepEqual(Array.from(a), Array.from(b))
  restorePrototypes()
})

test('mediaDevices：enumerateDevices 返回固定条目，两次一致', async () => {
  const h = makeHarness()
  installAll(cfgWith({}), h.env)
  const md = h.nav.mediaDevices as {
    enumerateDevices: () => Promise<Array<Record<string, unknown>>>
  }
  const first = await md.enumerateDevices()
  const second = await md.enumerateDevices()
  assert.equal(first.length, 3)
  assert.deepEqual(first, second)
  assert.deepEqual(
    first.map((d) => d.kind),
    ['audioinput', 'audiooutput', 'videoinput']
  )
  restorePrototypes()
})

test('Client Hints：getHighEntropyValues 只吐配置里有的项', async () => {
  const h = makeHarness()
  installAll(
    cfgWith({
      brands: [{ brand: 'Chromium', version: '140' }],
      uaPlatform: 'Windows',
      uaPlatformVersion: '15.0.0'
    }),
    h.env
  )
  const uaData = h.nav.userAgentData as {
    platform: string
    getHighEntropyValues: (hints: string[]) => Promise<Record<string, unknown>>
  }
  assert.equal(uaData.platform, 'Windows')
  const got = await uaData.getHighEntropyValues(['platform', 'platformVersion', 'brands'])
  assert.equal(got.platform, 'Windows')
  assert.equal(got.platformVersion, '15.0.0')
  assert.deepEqual(got.brands, [{ brand: 'Chromium', version: '140' }])
  restorePrototypes()
})

test('font：同一字体两次偏移相同，不同字体偏移不同', () => {
  const h = makeHarness()
  installAll(cfgWith({}), h.env)
  const ctx = h.canvas.getContext()
  const measure = ctx.measureText as unknown as (t: string) => { width: number }
  const a = measure('abcdefg').width
  const b = measure('abcdefg').width
  assert.equal(a, b)
  assert.notEqual(a, 56, '7 字符 × 8px 是未 hook 时的基线')
  restorePrototypes()
})

// ---------------------------------------------------------------- iframe

class FakeObserver {
  static built = 0
  static cb: ((records: unknown[]) => void) | null = null
  constructor(cb: (records: unknown[]) => void) {
    FakeObserver.built++
    FakeObserver.cb = cb
  }
  observe(): void {}
  disconnect(): void {}
}

function withFakeObserver(): typeof FakeObserver {
  FakeObserver.built = 0
  FakeObserver.cb = null
  ;(globalThis as unknown as Record<string, unknown>).MutationObserver = FakeObserver
  return FakeObserver
}

function withoutFakeObserver(): void {
  delete (globalThis as unknown as Record<string, unknown>).MutationObserver
}

test('iframe 跨域抛错：不冒泡，其余 hook 照常装上', () => {
  const h = makeHarness()
  const Obs = withFakeObserver()
  installAll(cfgWith({ hardwareConcurrency: 12 }), h.env)
  assert.equal(Obs.built, 1)

  const crossOrigin = {
    tagName: 'IFRAME',
    get contentWindow(): Record<string, unknown> {
      throw new Error('Blocked a frame with cross-origin access')
    }
  }
  assert.doesNotThrow(() => Obs.cb?.([{ addedNodes: [crossOrigin] }]))
  // 其余 hook 照常：跨域那一支挂了，主窗口的 navigator 覆盖还在。
  assert.equal(h.nav.hardwareConcurrency, 12)
  withoutFakeObserver()
  restorePrototypes()
})

test('iframe 同源：子窗口递归装上同一批 hook', () => {
  const h = makeHarness()
  const Obs = withFakeObserver()
  installAll(cfgWith({ hardwareConcurrency: 12 }), h.env)
  const child: Record<string, unknown> = { navigator: { hardwareConcurrency: 4 } }
  Obs.cb?.([{ addedNodes: [{ tagName: 'IFRAME', contentWindow: child }] }])
  assert.equal((child.navigator as Record<string, unknown>).hardwareConcurrency, 12)
  withoutFakeObserver()
  restorePrototypes()
})

// ---------------------------------------------------------------- 全关

test('全部开关关闭：所有原值保持不动，且不产生任何额外调用（R9）', () => {
  const h = makeHarness()
  const Obs = withFakeObserver()
  const baseline = h.canvas.toDataURL()
  const ctx = h.canvas.getContext()
  const baselineMetrics = (ctx.measureText as unknown as (t: string) => { width: number })(
    'abcdefg'
  ).width

  installAll({ seed: 20261028, toggles: allOff(), hardwareConcurrency: 12 }, h.env)

  assert.equal(h.nav.hardwareConcurrency, REAL_HARDWARE_CONCURRENCY)
  assert.equal(h.nav.deviceMemory, 4)
  assert.equal(h.nav.platform, 'RealPlatform')
  assert.equal(h.canvas.toDataURL(), baseline)
  assert.equal(
    (h.canvas.getContext().measureText as unknown as (t: string) => { width: number })('abcdefg')
      .width,
    baselineMetrics
  )
  assert.equal((h.webgl.getParameter as (p: number) => unknown)(0x1f01), 'RealGPU')
  assert.equal((h.audio.getChannelData as () => Float32Array)()[0], 0.5)
  // 不留空跑：观察器一次都没建、原型上一个属性都没添。
  assert.equal(Obs.built, 0)
  assert.deepEqual(Object.keys(h.navProto), [])

  withoutFakeObserver()
  restorePrototypes()
})
