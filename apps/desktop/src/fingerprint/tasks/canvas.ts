// src/fingerprint/tasks/canvas.ts
/**
 * Canvas 噪声。**只 hook 读取路径**：`getImageData` 与 `toDataURL`。
 *
 * 绘制路径（`fillRect` / `drawImage` / `putImageData`）一个都不碰——页面自己画的东西一个像素都
 * 不能变（spec 风险 3）。所以 `toDataURL` 的做法是：开一块同尺寸的离屏副本，把页面画布画上去，
 * 在**副本**上加噪声，再对副本调原始的 `toDataURL`。页面画布全程只读。
 *
 * index.ts 会把 `HTMLCanvasElement.prototype` 与 `CanvasRenderingContext2D.prototype`
 * 各传一次：前者只有 `toDataURL`，后者只有 `getImageData`，各装各的。
 */
import type { FpContext } from '../types.ts'
import { installHook, isOurs, markOurs } from '../core/hookFrame.ts'
import { mix32 } from '../core/mix32.ts'

type GetImageData = (this: unknown, ...args: unknown[]) => ImageData
type ToDataURL = (this: unknown, ...args: unknown[]) => string

export function install(ctx: FpContext): void {
  const { target, cfg, rand } = ctx
  const seed =
    (typeof cfg.canvasNoiseSeed === 'number'
      ? cfg.canvasNoiseSeed
      : Math.floor(rand() * 0xffffffff)) >>> 0

  if (typeof target.getImageData === 'function') {
    installHook<GetImageData>(
      target,
      'getImageData',
      (orig) =>
        function (this: unknown, ...args: unknown[]): ImageData {
          const img = orig.apply(this, args)
          // 自己人 = 我们为导出副本开的 2d context：它取的是副本，噪声由 toDataURL 自己加，
          // 这里再加一遍就成了两层噪声——而两层噪声和一层噪声一样随机，纯属白跑。
          if (!img || !img.data || isOurs(this)) return img
          addNoise(img.data, seed)
          return img
        },
      rand
    )
  }

  if (typeof target.toDataURL === 'function') {
    installHook<ToDataURL>(
      target,
      'toDataURL',
      (orig) =>
        function (this: unknown, ...args: unknown[]): string {
          const el = this as HTMLCanvasElement
          try {
            const w = el.width
            const h = el.height
            if (!w || !h) return orig.apply(el, args)
            const doc = el.ownerDocument
            if (!doc) return orig.apply(el, args)
            const scratch = doc.createElement('canvas')
            scratch.width = w
            scratch.height = h
            const sctx = scratch.getContext('2d')
            if (!sctx) return orig.apply(el, args)
            markOurs(sctx)
            sctx.drawImage(el, 0, 0)
            const img = sctx.getImageData(0, 0, w, h)
            addNoise(img.data, seed)
            sctx.putImageData(img, 0, 0)
            // 调的是原始实现：`scratch.toDataURL()` 会再进一次 hook，那就递归了。
            return orig.apply(scratch, args)
          } catch {
            // 跨域画布（getImageData 抛 SecurityError）、超大画布、离屏失败……
            // 一律退回原图：指纹少一项可以接受，页面导出不出图不行。
            return orig.apply(el, args)
          }
        },
      rand
    )
  }
}

/** ±1：够改变像素和的哈希，肉眼看不出。alpha 不动——动透明度会让页面自己的合成真的变样。 */
function addNoise(data: Uint8ClampedArray, seed: number): void {
  for (let i = 0; i < data.length; i++) {
    if (i % 4 === 3) continue
    data[i] = data[i] + ((mix32(seed, i) & 1) === 0 ? -1 : 1)
  }
}
