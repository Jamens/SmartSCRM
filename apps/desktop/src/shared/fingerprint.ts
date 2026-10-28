// src/shared/fingerprint.ts
/**
 * B14 指纹注入 · 主进程与页内脚本之间的契约（纯类型 + 常量，无副作用）。
 *
 * 与后端 `FingerprintRuntimeVO` 逐字段同形：后端已经把档案解析干净（brands 拆成对象、
 * 噪声种子哈希成数字），这里只负责搬运，不再做任何解析。
 *
 * **每个字段都是可选的，且"可选"是语义不是省略（spec R7）**：
 * 缺某一项 = 该项不改——不猜时区、不填 `'UTC'`、不把空串当"没写"的等价物。
 * 后来人请不要"顺手"给这些字段补默认值：补上去的默认值会静默生效，
 * 而静默生效的指纹比没有指纹危险（R2）。
 */
export const FP_TOGGLE_KEYS = [
  'navigator',
  'canvas',
  'webgl',
  'audio',
  'font',
  'mediaDevices',
  'iframe',
  'timezone'
] as const

export type FpToggleKey = (typeof FP_TOGGLE_KEYS)[number]

export interface FingerprintRuntime {
  profileId: number
  seed: number
  userAgent?: string
  uaPlatform?: string
  uaPlatformVersion?: string
  brands?: Array<{ brand: string; version: string }>
  locale?: string
  timezone?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  webglVendor?: string
  webglRenderer?: string
  canvasNoiseSeed?: number
  audioNoiseSeed?: number
  /** 缺省视为 true；关掉的项不施加（R9）。 */
  toggles: Partial<Record<FpToggleKey, boolean>>
}
