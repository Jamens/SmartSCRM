// src/fingerprint/tasks/webgl.ts
/**
 * `getParameter` 的厂商/渲染器伪装。
 *
 * 除了 `VENDOR` / `RENDERER`，还盖 `WEBGL_debug_renderer_info` 的两个 unmasked 常量：
 * 开了反指纹的浏览器把前两个抹成 "WebKit"/"WebKit WebGL"，指纹脚本真正读的是 unmasked 那两个。
 */
import type { FpContext } from '../types.ts'
import { installHook } from '../core/hookFrame.ts'

const VENDOR = 0x1f00
const RENDERER = 0x1f01
const UNMASKED_VENDOR = 0x9245
const UNMASKED_RENDERER = 0x9246

type GetParameter = (this: unknown, pname: number) => unknown

export function install(ctx: FpContext): void {
  const { target, cfg, rand } = ctx
  if (!cfg.webglVendor && !cfg.webglRenderer) return
  if (typeof target.getParameter !== 'function') return

  installHook<GetParameter>(
    target,
    'getParameter',
    (orig) =>
      function (this: unknown, pname: number): unknown {
        if (cfg.webglVendor && (pname === VENDOR || pname === UNMASKED_VENDOR))
          return cfg.webglVendor
        if (cfg.webglRenderer && (pname === RENDERER || pname === UNMASKED_RENDERER))
          return cfg.webglRenderer
        return orig.call(this, pname)
      },
    rand
  )
}
