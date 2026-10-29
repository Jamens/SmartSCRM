// src/fingerprint/tasks/audio.ts
/**
 * `AudioBuffer.getChannelData` 的采样扰动（幅度 ≤ 1e-6：人耳不可闻，但足以改掉哈希）。
 *
 * 就地扰动同一个 `Float32Array`，并用"自己人"标记保证**只扰一次**：
 * 每次都新造一份数组的话，页面写进去的采样会落到副本上；每次都扰一遍的话，
 * 连读两次会拿到两个不同的数组——两者都是自曝。
 */
import type { FpContext } from '../types.ts'
import { installHook, isOurs, markOurs } from '../core/hookFrame.ts'
import { mix32 } from '../core/mix32.ts'

const AMPLITUDE = 1e-6

type GetChannelData = (this: unknown, channel: number) => Float32Array

export function install(ctx: FpContext): void {
  const { target, cfg, rand } = ctx
  if (typeof target.getChannelData !== 'function') return
  const seed =
    (typeof cfg.audioNoiseSeed === 'number'
      ? cfg.audioNoiseSeed
      : Math.floor(rand() * 0xffffffff)) >>> 0

  installHook<GetChannelData>(
    target,
    'getChannelData',
    (orig) =>
      function (this: unknown, channel: number): Float32Array {
        const data = orig.call(this, channel)
        if (!(data instanceof Float32Array) || isOurs(data)) return data
        markOurs(data)
        for (let i = 0; i < data.length; i++) {
          data[i] = data[i] + ((mix32(seed, i) >>> 16) / 0xffff - 0.5) * 2 * AMPLITUDE
        }
        return data
      },
    rand
  )
}
