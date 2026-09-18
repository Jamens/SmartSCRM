/** Scan / throttle intervals, default settings and injected class names. */

export const TRANSLATION_POLL_INTERVAL = 1000
export const MESSAGE_SCAN_INTERVAL = 500
export const TRANSLATE_THROTTLE_TIME = 300
export const SCROLL_THROTTLE_TIME = 100
export const LOGIN_CHECK_INTERVAL = 3000
export const UNREAD_UPDATE_INTERVAL = 5000

export const DEFAULT_LANG_SETTING = { enabled: true, fromLang: 'auto', toLang: 'zh' }
export const DEFAULT_VOICE_SETTING = { enabled: true }

export const CSS_PREFIX = 'scrm-inject'

export const CSS_CLASSES = {
  TRANSLATED: `${CSS_PREFIX}-translated`,
  TRANSLATING: `${CSS_PREFIX}-translating`,
  TRANSLATE_ERROR: `${CSS_PREFIX}-translate-error`,
  VOICE_TEXT: `${CSS_PREFIX}-voice-text`,
  MASK: `${CSS_PREFIX}-mask`,
  LOADING: `${CSS_PREFIX}-loading`
}

export const VERSION = '2.0.0'
