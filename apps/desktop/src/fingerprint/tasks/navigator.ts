// src/fingerprint/tasks/navigator.ts
/**
 * navigator 属性与 Client Hints。
 *
 * 每一项都只在**配置里有值**时才覆盖（R7 缺项不改）。
 * index.ts 会拿两个目标各调一次：navigator 实例，与 `Navigator.prototype`——
 * 后者是 `userAgentData` 的所在地（它是原型上的只读 getter，只盖实例挡不住原型读取路径）。
 */
import type { FpContext } from '../types.ts'
import { installHook } from '../core/hookFrame.ts'

export function install(ctx: FpContext): void {
  const { target, cfg, rand } = ctx

  if (cfg.hardwareConcurrency != null) {
    installHook(target, 'hardwareConcurrency', () => cfg.hardwareConcurrency as number, rand)
  }
  if (cfg.deviceMemory != null) {
    installHook(target, 'deviceMemory', () => cfg.deviceMemory as number, rand)
  }
  if (cfg.locale) {
    installHook(target, 'languages', () => [cfg.locale as string], rand)
  }
  if (cfg.uaPlatform) {
    installHook(target, 'platform', () => cfg.uaPlatform as string, rand)
  }
  // vendor 没有自己的档案字段：由 UA 推（Chrome 系 / Safari / Firefox 各一个实值），
  // 推不出来就不盖——凭空填一个"看起来合理"的值正是 R7 要挡的事。
  const vendor = vendorOf(cfg.userAgent)
  if (vendor != null) {
    installHook(target, 'vendor', () => vendor, rand)
  }
  installUserAgentData(ctx)
}

function installUserAgentData(ctx: FpContext): void {
  const { cfg, rand } = ctx
  const data: Record<string, unknown> = {}
  if (cfg.brands) data.brands = cfg.brands.map((b) => ({ brand: b.brand, version: b.version }))
  if (cfg.uaPlatform) data.platform = cfg.uaPlatform
  if (cfg.uaPlatformVersion) data.platformVersion = cfg.uaPlatformVersion
  if (Object.keys(data).length === 0) return

  data.mobile = false
  data.getHighEntropyValues = (hints?: string[]): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {}
    const want = (k: string): boolean => !hints || hints.length === 0 || hints.indexOf(k) >= 0
    if (want('brands') && cfg.brands) out.brands = data.brands
    if (want('platform') && cfg.uaPlatform) out.platform = cfg.uaPlatform
    if (want('platformVersion') && cfg.uaPlatformVersion)
      out.platformVersion = cfg.uaPlatformVersion
    return Promise.resolve(out)
  }

  const put = (t: Record<string, unknown> | undefined): void => {
    if (t) installHook(t, 'userAgentData', () => data, rand)
  }
  put(ctx.target)
  if (typeof Navigator !== 'undefined') {
    put(Navigator.prototype as unknown as Record<string, unknown>)
  }
}

/** Chrome 的 UA 里也带 `Safari/`，所以先判 Chrome 系再判 Safari。 */
function vendorOf(ua: string | undefined): string | null {
  if (!ua) return null
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'Google Inc.'
  if (/Firefox\//.test(ua)) return ''
  if (/Safari\//.test(ua)) return 'Apple Computer, Inc.'
  return null
}
