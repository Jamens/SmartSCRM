import { resolveEffectiveTheme, type EffectiveTheme, type ThemePref } from '@shared/theme'

const DARK_CLASS = 'dark'

/** 设置页与首绘共用的一份状态：用户选的档、实际生效的档、操作系统现在的档。 */
export interface ThemeUiState {
  pref: ThemePref
  effective: EffectiveTheme
  systemDark: boolean
  /** electron = 档位能落盘；browser = 纯浏览器预览，只在本次会话里生效。UI 要据此说实话。 */
  host: 'electron' | 'browser'
}

/** 页面只挂/摘一个类：颜色全走 `main.css` 的令牌层，不留第二套样式分支。 */
export function applyThemeClass(theme: EffectiveTheme): void {
  const root = document.documentElement
  root.classList.toggle(DARK_CLASS, theme === 'dark')
  // 一并声明给 UA：滚动条、表单控件这些原生画法跟着翻，否则深色档里会留着白条。
  root.style.colorScheme = theme
}

export function readThemeClass(): EffectiveTheme {
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light'
}

function systemDarkInBrowser(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

function browserState(): ThemeUiState {
  const systemDark = systemDarkInBrowser()
  return {
    pref: 'system',
    effective: resolveEffectiveTheme('system', systemDark),
    systemDark,
    host: 'browser'
  }
}

/**
 * 读当前档位。主进程问不到（纯浏览器 dev）就用操作系统兜底。
 * **永不 reject**：主题没读到不该挡住应用启动。
 */
export async function loadThemeState(): Promise<ThemeUiState> {
  if (!window.scrm) return browserState()
  try {
    const snapshot = await window.scrm.settings.theme()
    return { ...snapshot, host: 'electron' }
  } catch {
    return browserState()
  }
}

/**
 * 改档。Electron 下由主进程落盘、改 `nativeTheme`、再广播回来；
 * 浏览器下没有落盘处，只把类挂上去并如实报 `host: 'browser'`。
 */
export async function setThemePref(pref: ThemePref): Promise<ThemeUiState> {
  if (!window.scrm) {
    const systemDark = systemDarkInBrowser()
    const next: ThemeUiState = {
      pref,
      effective: resolveEffectiveTheme(pref, systemDark),
      systemDark,
      host: 'browser'
    }
    applyThemeClass(next.effective)
    return next
  }
  await window.scrm.settings.set({ theme: pref })
  // 广播可能已经先到，这里再取一次快照当权威值——两头都拿到同一个来源才不会出现按钮和页面不一致。
  return loadThemeState()
}

/**
 * 订阅变化。系统偏好运行中会翻转，而 `nativeTheme` 只有主进程读得到，所以 Electron 下等它推；
 * 浏览器下只能自己挂 matchMedia。返回解绑函数。
 */
export function watchThemeState(onChange: (state: ThemeUiState) => void): () => void {
  if (window.scrm) {
    return window.scrm.settings.onThemeChanged((snapshot) =>
      onChange({ ...snapshot, host: 'electron' })
    )
  }
  if (typeof window.matchMedia !== 'function') return () => undefined
  const list = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (event: MediaQueryListEvent): void => {
    onChange({
      ...browserState(),
      systemDark: event.matches,
      effective: resolveEffectiveTheme('system', event.matches)
    })
  }
  list.addEventListener('change', handler)
  return () => list.removeEventListener('change', handler)
}
