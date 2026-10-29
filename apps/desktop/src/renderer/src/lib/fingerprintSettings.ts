// src/renderer/src/lib/fingerprintSettings.ts
//
// B14 指纹注入设置（渲染层这一段）。
//
// 分工照抄 `useBadgeEnabled`：档位存在主进程（`scrm-settings.json`），这里只是它的一个客户端——
// 读初值 → 订阅广播 → 写的时候以主进程回的那份为权威值。不另起全局 store：两个布尔集合不值得多一层。
import { useCallback, useEffect, useState } from 'react'
import { FP_TOGGLE_KEYS, type FpToggleKey } from '@shared/fingerprint'

/**
 * 主进程读不到时的取值：与 `DEFAULTS.fingerprintEnabled` 同一个默认——**默认关**。
 *
 * 不是保守：这套能力（Canvas 噪声 / WebGL 伪装 / Audio 扰动）的目的就是让页面的自动化检测
 * 读不到真实值，它越过了本仓 README 原本「不探测、不伪装真实设备」的开源红线口径。
 * 能力就位，但不默认启用；要它生效得两件事都做：账号显式绑一份档案 + 这里显式打开（spec R2 / R9）。
 */
const ENABLED_DEFAULT = false

/** 单项开关的缺省：没出现过的项视为开——只有显式写成 false 才关（R9）。 */
function toggleOf(
  toggles: Partial<Record<FpToggleKey, boolean>> | undefined,
  key: FpToggleKey
): boolean {
  return toggles?.[key] !== false
}

export function useFingerprintSettings(): {
  enabled: boolean
  toggles: Partial<Record<FpToggleKey, boolean>>
  /** electron = 开关能落盘并由主进程广播；browser = 纯浏览器预览，改了没处存。UI 据此说实话。 */
  host: 'electron' | 'browser'
  setEnabled: (next: boolean) => void
  setToggle: (key: FpToggleKey, next: boolean) => void
} {
  const [enabled, setEnabled] = useState(ENABLED_DEFAULT)
  const [toggles, setToggles] = useState<Partial<Record<FpToggleKey, boolean>>>({})
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  useEffect(() => {
    if (!window.scrm) return
    let alive = true
    void window.scrm.settings
      .get()
      .then((s) => {
        if (!alive) return
        setEnabled(s.fingerprintEnabled)
        setToggles(s.fingerprintToggles ?? {})
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.settings.onChanged((s) => {
      setEnabled(s.fingerprintEnabled)
      setToggles(s.fingerprintToggles ?? {})
    })
  }, [])

  const write = useCallback((patch: { fingerprintEnabled?: boolean; fingerprintToggles?: Partial<Record<FpToggleKey, boolean>> }): void => {
    // 先按点下去的值翻，再用主进程的回包与广播纠正：开关点了不动比晚一拍更糟。
    if (patch.fingerprintEnabled !== undefined) setEnabled(patch.fingerprintEnabled)
    if (patch.fingerprintToggles !== undefined) setToggles(patch.fingerprintToggles)
    const api = window.scrm
    if (!api) return
    const done = (s: { fingerprintEnabled: boolean; fingerprintToggles?: Partial<Record<FpToggleKey, boolean>> }): void => {
      setEnabled(s.fingerprintEnabled)
      setToggles(s.fingerprintToggles ?? {})
    }
    api.settings
      .set(patch)
      .then(done)
      // 写失败（文件被占用等）就把主进程那份读回来，别让界面停在一个没落地的值上。
      .catch(() => {
        void api.settings.get().then(done, () => undefined)
      })
  }, [])

  const setEnabledNext = useCallback((next: boolean): void => write({ fingerprintEnabled: next }), [write])

  const setToggle = useCallback(
    (key: FpToggleKey, next: boolean): void => {
      // 全量下发这八个键：主进程那边是逐键校验后整体替换，只发一个键就会把其余的留成默认值（开）。
      const nextAll: Partial<Record<FpToggleKey, boolean>> = {}
      for (const k of FP_TOGGLE_KEYS) nextAll[k] = k === key ? next : toggleOf(toggles, k)
      write({ fingerprintToggles: nextAll })
    },
    [write, toggles]
  )

  return { enabled, toggles, host, setEnabled: setEnabledNext, setToggle }
}
