// src/main/services/fingerprint/runtime.ts
// 走相对路径而不是 `@shared/*` 别名：别名只有打包器认得，`node --test` 直跑 .ts 解析不到。
import { FP_TOGGLE_KEYS } from '../../../shared/fingerprint.ts'
import type { FingerprintRuntime, FpToggleKey } from '../../../shared/fingerprint.ts'

/**
 * 后端 `FingerprintRuntimeVO` 在 JSON 里的形状：字段逐一同形，缺项一律为 null。
 * 用 `null` 而不是"字段不存在"来表达缺项，是为了和后端对齐——后端 record 的每个分量都会序列化出来。
 */
export interface FingerprintProfileRow {
  profileId: number
  seed: number
  userAgent: string | null
  uaPlatform: string | null
  uaPlatformVersion: string | null
  /** 后端 `BrandVO` 的分量理论可空，但这里按"一条 brand 必有 brand/version"收：缺名的 brand 没有意义，
   *  且这一层不做任何补全——真出现了空分量，是后端解析该收紧，不是这里替它猜。 */
  brands: Array<{ brand: string; version: string }> | null
  locale: string | null
  timezone: string | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  webglVendor: string | null
  webglRenderer: string | null
  canvasNoiseSeed: number | null
  audioNoiseSeed: number | null
}

export interface FingerprintSettings {
  enabled: boolean
  toggles: Partial<Record<FpToggleKey, boolean>>
}

/** null / undefined / 空串 → undefined（该项不改）。空串不是有效值，与 null 同义。 */
function text(value: string | null | undefined): string | undefined {
  return value == null || value === '' ? undefined : value
}

/** null / undefined → undefined。0 是有效值，不能当成缺失。 */
function num(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value
}

/**
 * 档案 + 设置 → 运行时指纹参数。返回 `null` = **不施加任何指纹**。
 *
 * 三条短路，任一成立即返回 null：
 * 1. 没绑档案（R2）——静默生效的指纹比没有指纹危险，绝不兜底生成一份；
 * 2. 全局开关关（R9）；
 * 3. 除 profileId / seed 外全空——等于没配，施加了也只是给自己找麻烦。
 *
 * 逐字段搬运：**不猜、不补全**。档案的 timezone 是 null，runtime 的 timezone 就是 undefined，
 * 不是 `''`、不是 `'UTC'`（R7）。唯一的例外是 brands 的空数组——那是显式意图（"一个 brand 都不给"），
 * 与"没配 brands"是两回事，必须保留。
 */
export function resolveRuntime(
  profile: FingerprintProfileRow | null | undefined,
  settings: FingerprintSettings
): FingerprintRuntime | null {
  if (!profile) return null
  if (!settings.enabled) return null

  const brands = profile.brands ?? undefined
  const runtime: FingerprintRuntime = {
    profileId: profile.profileId,
    seed: profile.seed,
    userAgent: text(profile.userAgent),
    uaPlatform: text(profile.uaPlatform),
    uaPlatformVersion: text(profile.uaPlatformVersion),
    brands,
    locale: text(profile.locale),
    timezone: text(profile.timezone),
    hardwareConcurrency: num(profile.hardwareConcurrency),
    deviceMemory: num(profile.deviceMemory),
    webglVendor: text(profile.webglVendor),
    webglRenderer: text(profile.webglRenderer),
    canvasNoiseSeed: num(profile.canvasNoiseSeed),
    audioNoiseSeed: num(profile.audioNoiseSeed),
    toggles: {}
  }

  const configured =
    runtime.userAgent != null ||
    runtime.uaPlatform != null ||
    runtime.uaPlatformVersion != null ||
    brands != null ||
    runtime.locale != null ||
    runtime.timezone != null ||
    runtime.hardwareConcurrency != null ||
    runtime.deviceMemory != null ||
    runtime.webglVendor != null ||
    runtime.webglRenderer != null ||
    runtime.canvasNoiseSeed != null ||
    runtime.audioNoiseSeed != null
  if (!configured) return null

  // 默认全开：没出现在 settings.toggles 里的项视为开，只有显式写成 false 才关（R9）。
  const toggles: Partial<Record<FpToggleKey, boolean>> = {}
  for (const key of FP_TOGGLE_KEYS) {
    toggles[key] = settings.toggles[key] !== false
  }
  runtime.toggles = toggles
  return runtime
}
