// src/fingerprint/tasks/font.ts
/**
 * 字体探测（归 `font` 开关）：给 `measureText` 的宽度加一个按字体名固定的偏移。
 *
 * 字体指纹的做法是「同一串字换个字体各量一次宽度，看谁不一样」。偏移必须**按字体名固定**：
 * 同一字体两次量出两个宽度，是比"量出真值"更响的自曝。所以偏移由 (font, 噪声基数) 直接算出，
 * 不走有状态的 rand 序列。
 */
import type { FpContext } from '../types.ts'
import { installHook } from '../core/hookFrame.ts'
import { mix32 } from '../core/mix32.ts'

/** 除 width 外原样搬运的度量；站点会读它们算基线。 */
const METRIC_KEYS = [
  'actualBoundingBoxLeft',
  'actualBoundingBoxRight',
  'actualBoundingBoxAscent',
  'actualBoundingBoxDescent',
  'fontBoundingBoxAscent',
  'fontBoundingBoxDescent'
] as const

type MeasureText = (this: unknown, text: string) => TextMetrics

function fontHash(font: string): number {
  let h = 2166136261
  for (let i = 0; i < font.length; i++) h = mix32(h ^ font.charCodeAt(i), i)
  return h >>> 0
}

/** ±0.3px：够改变"哪个字体命中"的判定，又不会让页面量出来的排版真的错乱。 */
function offsetOf(font: string, base: number): number {
  return ((fontHash(font + '|' + base) % 2000) / 2000 - 0.5) * 0.6
}

export function install(ctx: FpContext): void {
  const { target, rand } = ctx
  if (typeof target.measureText !== 'function') return
  const base = Math.floor(rand() * 0xffffff)

  installHook<MeasureText>(
    target,
    'measureText',
    (orig) =>
      function (this: unknown, text: string): TextMetrics {
        const m = orig.call(this, text)
        const font = fontOf(this)
        const out: Record<string, unknown> = { width: m.width + offsetOf(font, base) }
        for (const k of METRIC_KEYS) {
          const v = (m as unknown as Record<string, unknown>)[k]
          if (typeof v === 'number') out[k] = v
        }
        return out as unknown as TextMetrics
      },
    rand
  )
}

function fontOf(owner: unknown): string {
  const f = (owner as { font?: unknown } | null)?.font
  return typeof f === 'string' ? f : ''
}
