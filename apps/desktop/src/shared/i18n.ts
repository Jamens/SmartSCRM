/**
 * UI 多语言框架（A4）。
 *
 * 这里只放「语言清单 + 校验」，不放任何文案——文案在渲染层的 `i18n/locales/*`。
 * 之所以放 `@shared`：主进程的 `AppSettings.language` 需要校验「是不是受支持的语种」，
 * 渲染层的语言切换器需要同一份清单。两侧共用一份真值，才不会一个认、一个不认。
 *
 * 只提供 zh-CN / en 两份完整译文；其余 6 种先列在框架里（切换器能选），
 * 未译的会回退到 `fallbackLng`（zh-CN）。补齐译文即可，不动任何调用方。
 */

export interface LocaleDef {
  /** BCP-47 风格代码，同时作为切换器的值与 i18next 的 `lng`。 */
  code: string
  /** 该语种对自己的称呼（母语自称），切换器里这样显示最准。 */
  label: string
}

/** 8 语种框架：中文 / 英文 起，其余覆盖东南亚主要市场（跨境团队常用）。 */
export const SUPPORTED_LOCALES: readonly LocaleDef[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' }
] as const

/** 受支持语种代码的联合类型，主进程落盘与渲染层切换器都约束到它。 */
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code']

const KNOWN = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code))

/** 窄化判断：只有列在清单里的代码才采信，避免把任意字符串写进设置文件。 */
export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && KNOWN.has(value)
}

/** i18next 的回退语种：未译的语种都落到这里。 */
export const FALLBACK_LOCALE: LocaleCode = 'zh-CN'
