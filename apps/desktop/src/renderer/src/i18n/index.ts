import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { isLocaleCode, FALLBACK_LOCALE, type LocaleCode } from '@shared/i18n'
import { zhCN } from './locales/zh-CN'
import { en } from './locales/en'
import { zhTW } from './locales/zh-TW'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { vi } from './locales/vi'
import { id } from './locales/id'
import { th } from './locales/th'

/**
 * i18n 实例（A4）。文案是打包进来的（不是 fetch），所以 `init` 之后 `t()` 立刻可用、
 * 不需要 loading 态。首帧之前由 `main.tsx` 调一次 `initI18n()`，把持久化的语言读出来当 `lng`。
 */
export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  'zh-TW': { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
  vi: { translation: vi },
  id: { translation: id },
  th: { translation: th }
} as const

let initialized = false

/** 读主进程落盘的语言；问不到或不是受支持语种就回退默认语种。永不 reject。 */
async function loadLanguage(): Promise<LocaleCode> {
  try {
    const settings = await window.scrm?.settings.get()
    if (settings && isLocaleCode(settings.language)) return settings.language
  } catch {
    // 纯浏览器预览 / 主进程没响应：用默认语种，不该挡住启动。
  }
  return FALLBACK_LOCALE
}

export async function initI18n(): Promise<void> {
  if (initialized) return
  initialized = true
  const lng = await loadLanguage()
  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: FALLBACK_LOCALE,
    // 文案我们自己写，没有 HTML，关掉转义省得和 React 的 XSS 防护打架。
    interpolation: { escapeValue: false },
    // 取不到的键返回 key 而不是 null，便于在界面上立刻看出「这句没翻」。
    returnNull: false
  })
}

/** 切换运行时语言（用户在下拉框选了别的语种时）。落盘由调用方走 settings 接口。 */
export function changeLanguage(lng: LocaleCode): void {
  void i18n.changeLanguage(lng)
}

export { i18n }
