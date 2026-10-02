import { useCallback, useEffect, useState } from 'react'
import type { GpuFatalInfo } from '@shared/gpu'

/**
 * 图形降级（A18）的渲染层这一段。
 *
 * 分工按"谁知道什么"切，与 `lib/unreadBadge.ts` 同构：
 * 开关的偏好只有主进程落盘，重启这种"杀进程"的事只有主进程能做，渲染层只负责
 * 把"用户想要的模式"存进设置并请求重启——它不该直接碰 `app`。
 */

/** 与主进程 `DEFAULTS` 同步的默认：开着的开关不用等落盘才显示对。 */
const GPU_DEFAULT = { hardwareAcceleration: true, gpuSafeMode: false }

export interface GpuSettings {
  hardwareAcceleration: boolean
  /** true = 上次因 GPU 崩溃被自动降级，当前处于软件渲染模式。 */
  gpuSafeMode: boolean
  /** electron = 能落盘、能重启；browser = 纯浏览器预览，这里没有 GPU 后端可切。UI 据此说实话。 */
  host: 'electron' | 'browser'
  /** 切换硬件加速开关。改动需重启生效，会请求主进程带 `--gpu-safe-mode` 重启。 */
  setHardwareAcceleration: (next: boolean) => void
  /** 一键回到标准模式：清掉安全标记并重启进标准渲染。 */
  retryStandard: () => void
}

export function useGpuSettings(): GpuSettings {
  const [state, setState] = useState(GPU_DEFAULT)
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  useEffect(() => {
    if (!window.scrm) return
    let alive = true
    void window.scrm.settings
      .get()
      .then((s) => alive && setState({ hardwareAcceleration: s.hardwareAcceleration, gpuSafeMode: s.gpuSafeMode }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.settings.onChanged((s) =>
      setState({ hardwareAcceleration: s.hardwareAcceleration, gpuSafeMode: s.gpuSafeMode })
    )
  }, [])

  const setHardwareAcceleration = useCallback((next: boolean): void => {
    // 先按点下去的值翻，重启前的那帧不出现"点了没反应"。
    setState((prev) => ({ ...prev, hardwareAcceleration: next }))
    const done = (s: { hardwareAcceleration: boolean; gpuSafeMode: boolean }): void =>
      setState({ hardwareAcceleration: s.hardwareAcceleration, gpuSafeMode: s.gpuSafeMode })
    // 先落盘再重启：settings:set 在主进程是同步写盘，promise resolve 时文件已经改好。
    // 关掉硬件加速时不要把安全标记清掉（那是独立的崩溃状态）；打开时则一并清掉（等于回到标准）。
    const patch = next
      ? { hardwareAcceleration: true, gpuSafeMode: false }
      : { hardwareAcceleration: false }
    window.scrm?.settings
      .set(patch)
      .then(done)
      // 写失败（文件被占用等）就把主进程那份读回来，别让界面停在一个没落地的值上。
      .catch(() => {
        void window.scrm?.settings.get().then(done, () => undefined)
      })
      // 无论写没写成功都请求重启：改动必须重启才生效，且主进程会按当前设置定降级态。
      .finally(() => {
        window.scrm?.gpu.restart(!next)
      })
  }, [])

  const retryStandard = useCallback((): void => {
    window.scrm?.settings
      .set({ hardwareAcceleration: true, gpuSafeMode: false })
      .catch(() => undefined)
      .finally(() => {
        window.scrm?.gpu.restart(false)
      })
  }, [])

  return { ...state, host, setHardwareAcceleration, retryStandard }
}

/**
 * 降级模式下 GPU 仍崩溃的订阅。那时主进程不再重启（避免死循环），只推这条。
 * 返回最近一次诊断信息；用于设置页给出"请排查显卡驱动"的明确提示。
 */
export function useGpuFatal(): GpuFatalInfo | null {
  const [info, setInfo] = useState<GpuFatalInfo | null>(null)
  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.gpu.onFatal((i) => setInfo(i))
  }, [])
  return info
}
