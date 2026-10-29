// src/fingerprint/index.ts
/**
 * 页内指纹脚本入口。
 *
 * 由主进程用 CDP `Page.addScriptToEvaluateOnNewDocument` 在**文档创建前**注入，
 * 因此早于页面自己的任何脚本（R4——晚一步就等于没生效）。
 * 唯一的输入是主进程塞进来的 `window.__FP_CONFIG__`：没有它就一行都不装。
 * 不发 IPC、不依赖 wa-js、不依赖 `window.ele`（R8）。
 */
import { FP_TOGGLE_KEYS } from '../shared/fingerprint.ts'
import type { FingerprintRuntime, FpToggleKey } from '../shared/fingerprint.ts'
import { mulberry32 } from './core/seededRandom.ts'
import { setFrameInstaller } from './tasks/iframe.ts'
import type { FpContext, FpEnv } from './types.ts'
import * as audioTask from './tasks/audio.ts'
import * as canvasTask from './tasks/canvas.ts'
import * as fontTask from './tasks/font.ts'
import * as iframeTask from './tasks/iframe.ts'
import * as mediaDevicesTask from './tasks/mediaDevices.ts'
import * as navigatorTask from './tasks/navigator.ts'
import * as webglTask from './tasks/webgl.ts'

type Task = (ctx: FpContext) => void

/** iframe 单独走：它要的是 document + 全局 MutationObserver，不是某个原型。 */
const TASKS: Partial<Record<FpToggleKey, Task>> = {
  navigator: navigatorTask.install,
  mediaDevices: mediaDevicesTask.install,
  font: fontTask.install,
  canvas: canvasTask.install,
  webgl: webglTask.install,
  audio: audioTask.install
}

/** 每项能力要 patch 哪些目标。缺的返回空数组 = 这项静默不生效（不因缺一个原型连累其它项）。 */
function targetsOf(key: FpToggleKey, env: FpEnv): Array<Record<string, unknown>> {
  switch (key) {
    case 'navigator':
      return only(env.navigator, env.navigatorProto)
    case 'mediaDevices':
      return only(env.navigator)
    case 'font':
      return only(env.canvasCtx)
    case 'canvas':
      return only(env.canvasEl, env.canvasCtx)
    case 'webgl':
      return env.webgl ?? []
    case 'audio':
      return only(env.audioBuffer)
    default:
      return []
  }
}

function only(...xs: Array<Record<string, unknown> | undefined>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const x of xs) if (x) out.push(x)
  return out
}

/**
 * 按开关逐项安装。**每一项各自 try/catch**：一项抛了/装不上，只让那一项失效。
 * 关掉的项一个目标都不碰（R9：不留空跑的定时器、不产生额外调用）。
 */
export function installAll(cfg: Partial<FingerprintRuntime>, env: FpEnv): void {
  const rand = mulberry32(cfg.seed ?? 0)
  const on = (key: FpToggleKey): boolean => cfg.toggles?.[key] !== false

  for (const key of FP_TOGGLE_KEYS) {
    if (!on(key)) continue
    if (key === 'iframe') {
      for (const doc of only(env.document)) {
        safe(() => iframeTask.install({ target: doc, rand, cfg }))
      }
      continue
    }
    const task = TASKS[key]
    if (!task) continue
    for (const target of targetsOf(key, env)) {
      safe(() => task({ target, rand, cfg }))
    }
  }
}

/** 页内脚本一律静默（C3）：失败模式是"不生效"，不上报、不打日志。 */
function safe(fn: () => void): void {
  try {
    fn()
  } catch {
    // 一项装不上不能连累其它项。
  }
}

/** 生产：从 window 抓要 patch 的实例与原型。 */
export function envOf(w: Record<string, unknown>): FpEnv {
  const proto = (name: string): Record<string, unknown> | undefined => {
    const c = w[name]
    if (typeof c !== 'function') return undefined
    return (c as { prototype?: unknown }).prototype as Record<string, unknown> | undefined
  }
  const webgl: Array<Record<string, unknown>> = []
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const p = proto(name)
    if (p) webgl.push(p)
  }
  return {
    navigator: w.navigator as Record<string, unknown> | undefined,
    navigatorProto: proto('Navigator'),
    canvasEl: proto('HTMLCanvasElement'),
    canvasCtx: proto('CanvasRenderingContext2D'),
    webgl,
    audioBuffer: proto('AudioBuffer'),
    document: w.document as Record<string, unknown> | undefined,
    window: w
  }
}

// iframe 递归：往子窗口里装的是同一批 install，用同一份 cfg（指纹在视图内必须一致，R3）。
setFrameInstaller((win, cfg) => installAll(cfg, envOf(win)))

// 没有配置就一行都不装：未绑档案的账号行为必须与改动前完全一致（R2）。
if (typeof window !== 'undefined') {
  const cfg = (window as unknown as Record<string, unknown>).__FP_CONFIG__ as
    Partial<FingerprintRuntime> | undefined
  if (cfg) installAll(cfg, envOf(window as unknown as Record<string, unknown>))
}
