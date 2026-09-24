/**
 * 主题档位。`system` 不是第三种颜色，而是"跟着操作系统的深色偏好走"，
 * 所以它必须在被交给渲染层之前解析成一个确定值：窗口底色与页面底色若各自判断，
 * 切档、启动、缩放时会露出一条错色接缝（窗口有底色，页面还没画上来）。
 */
export type ThemePref = 'light' | 'dark' | 'system'

/** 解析后的档位——页面上真正生效的那个，只有两态。 */
export type EffectiveTheme = 'light' | 'dark'

export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system']

/** 落盘的值来自用户手改过的 JSON，必须先过这道判定再采信。 */
export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value)
}

/**
 * 纯函数：给定档位与"系统当前是否深色"，得出生效档。
 * 非 system 的档位完全忽略系统值——用户显式选了就与他无关。
 */
export function resolveEffectiveTheme(pref: ThemePref, systemDark: boolean): EffectiveTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

/**
 * BrowserWindow 的 `backgroundColor` 只吃十六进制，读不到 CSS 变量，两处只能手工对齐：
 * `light` 是应用一直在用的值，`dark` 是 `main.css` 里 `.dark { --background }`
 * 那个 oklch 的 sRGB 换算结果（oklch(0.17 0.03 265) → #090f1c）。
 * 改任一处令牌都要回来同步这里，否则启动瞬间的底色与页面底色不接。
 */
export const WINDOW_BACKGROUND: Record<EffectiveTheme, string> = {
  light: '#f7f8fb',
  dark: '#090f1c'
}

export function windowBackgroundOf(theme: EffectiveTheme): string {
  return WINDOW_BACKGROUND[theme]
}
