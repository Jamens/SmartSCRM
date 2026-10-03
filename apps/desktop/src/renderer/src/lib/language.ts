import { useCallback, useEffect, useState } from 'react'
import { isLocaleCode, FALLBACK_LOCALE, type LocaleCode } from '@shared/i18n'
import { changeLanguage, i18n } from '@/i18n'

/**
 * 语言（A4）的渲染层这一段。
 *
 * 与 `lib/gpu.ts` / `lib/theme.ts` 同构：偏好只住在主进程（`AppSettings.language`），
 * 渲染层是客户端——读它、订阅它的变化、把用户选的值写回去并切到对应语种。
 * 不在这里直接碰 i18next 的持久化，落盘统一走 `settings:set`。
 */

/** 与主进程 `DEFAULTS` 同步的默认：进设置页时即使没读到落盘值也不闪空。 */
const LANG_DEFAULT: LocaleCode = FALLBACK_LOCALE

export interface LanguageSettings {
  language: LocaleCode
  /** electron = 能落盘；browser = 纯浏览器预览，切了本次会话有效、不落盘。UI 据此说实话。 */
  host: 'electron' | 'browser'
  setLanguage: (next: LocaleCode) => void
}

export function useLanguage(): LanguageSettings {
  const [language, setLang] = useState<LocaleCode>(
    () => (isLocaleCode(i18n.language) ? i18n.language : LANG_DEFAULT)
  )
  const [host] = useState<'electron' | 'browser'>(() => (window.scrm ? 'electron' : 'browser'))

  // 主进程推来的设置变化（例如别的入口改了语言）同步到本地状态。
  useEffect(() => {
    if (!window.scrm) return
    return window.scrm.settings.onChanged((s) => {
      if (isLocaleCode(s.language)) setLang(s.language)
    })
  }, [])

  const setLanguage = useCallback((next: LocaleCode): void => {
    // 先切再写：界面立刻跟着变，落盘失败也只是下次启动回退，不卡这一帧。
    setLang(next)
    changeLanguage(next)
    if (!window.scrm) return
    // 落盘由主进程统一负责（写 scrm-settings.json），无论成功与否都不阻塞 UI。
    window.scrm.settings.set({ language: next }).catch(() => undefined)
  }, [])

  return { language, host, setLanguage }
}
