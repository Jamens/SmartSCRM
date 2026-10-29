// src/fingerprint/tasks/mediaDevices.ts
/**
 * `navigator.mediaDevices.enumerateDevices()`：返回两三条固定设备。
 *
 * 设备列表在 **install 时算一次**并闭包住：每次调用都现取 rand 的话，
 * 同一视图两次枚举会给出两套 deviceId——那等于把"我在伪装"写在脸上（R3）。
 * 只换 `enumerateDevices` 这一个方法，`getUserMedia` 等原样保留。
 */
import type { FpContext } from '../types.ts'
import { installHook } from '../core/hookFrame.ts'

const DEVICE_PLAN: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: 'audioinput', label: '默认 - 麦克风' },
  { kind: 'audiooutput', label: '默认 - 扬声器' },
  { kind: 'videoinput', label: '默认 - 摄像头' }
]

function hex(rand: () => number, len: number): string {
  let s = ''
  while (s.length < len) s += ((rand() * 0x100000000) >>> 0).toString(16).padStart(8, '0')
  return s.slice(0, len)
}

export function install(ctx: FpContext): void {
  const { target, rand } = ctx
  const groupId = hex(rand, 32)
  const devices = DEVICE_PLAN.map((d) => ({
    deviceId: hex(rand, 32),
    kind: d.kind,
    label: d.label,
    groupId
  }))
  const enumerate = (): Promise<unknown> => Promise.resolve(devices)

  const md = target.mediaDevices
  if (md && typeof md === 'object') {
    installHook(md as Record<string, unknown>, 'enumerateDevices', () => enumerate, rand)
    return
  }
  installHook(target, 'mediaDevices', () => ({ enumerateDevices: enumerate }), rand)
}
