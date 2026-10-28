// src/fingerprint/types.ts
/**
 * 页内指纹脚本的公共形状。
 *
 * 这份产物是**第三份独立 bundle**（R8）：不依赖 wa-js、不依赖 `window.ele`、不发任何 IPC，
 * 唯一的输入是主进程在文档创建前塞进来的只读配置 `window.__FP_CONFIG__`。
 */
import type { FingerprintRuntime } from '../shared/fingerprint.ts'

export type { FingerprintRuntime }

/**
 * 每个 task 的入参。**要 patch 的全局对象一律从参数传入**，不在 task 里直接摸 window。
 *
 * Node 里没有 DOM：`navigator` / `HTMLCanvasElement` 都不存在。把目标从参数递进来，
 * `node --test` 就能传 stub 跑真逻辑，而不是跑一堆 `typeof x !== 'undefined'` 的空壳。
 */
export interface FpContext {
  /** 要 patch 的目标：生产里是 window / Navigator.prototype / 各原型对象，测试里是 stub。 */
  target: Record<string, unknown>
  /** mulberry32 种子随机：同 seed 稳定、不同 seed 各异。 */
  rand: () => number
  /** 已按开关剔除过的配置；某项为 undefined = 这项关了或档案没配（R7 缺项不改）。 */
  cfg: Partial<FingerprintRuntime>
}

/**
 * 页内脚本要 patch 的全局对象集合。
 *
 * 生产里由 `envOf(window)` 抓真对象，测试里按需只给要验的那几项——
 * 缺哪个就跳过哪个（一个原型不存在不能让整批 hook 都装不上）。
 */
export interface FpEnv {
  /** `window.navigator` 实例。 */
  navigator?: Record<string, unknown>
  /** `Navigator.prototype`：`userAgentData` 是原型上的只读 getter，只盖实例挡不住原型读取路径。 */
  navigatorProto?: Record<string, unknown>
  /** `HTMLCanvasElement.prototype`：`toDataURL`。 */
  canvasEl?: Record<string, unknown>
  /** `CanvasRenderingContext2D.prototype`：`getImageData` / `measureText`。 */
  canvasCtx?: Record<string, unknown>
  /** `WebGLRenderingContext.prototype` 与 `WebGL2RenderingContext.prototype`。 */
  webgl?: Record<string, unknown>[]
  /** `AudioBuffer.prototype`：`getChannelData`。 */
  audioBuffer?: Record<string, unknown>
  /** `document`：iframe 任务的 MutationObserver 挂这儿。 */
  document?: Record<string, unknown>
  /** iframe 递归时重新抓 env 用。 */
  window?: Record<string, unknown>
}
