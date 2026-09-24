import { app, nativeTheme } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  isThemePref,
  resolveEffectiveTheme,
  type EffectiveTheme,
  type ThemePref
} from '@shared/theme'

/**
 * 用户设置。与会话文件（`session.ts`）同住 `userData`，但**不加密**：
 * 这里只有外观档，不是凭据；加密反而会让主进程在 safeStorage 不可用时读不回档位。
 */
export interface AppSettings {
  theme: ThemePref
}

/** 交给渲染层的完整快照：`effective` 由主进程解析，页面只负责挂类名。 */
export interface ThemeSnapshot {
  pref: ThemePref
  effective: EffectiveTheme
  systemDark: boolean
}

const DEFAULTS: AppSettings = { theme: 'system' }

const settingsFile = (): string => join(app.getPath('userData'), 'scrm-settings.json')

let current: AppSettings = { ...DEFAULTS }

function sanitize(raw: unknown): AppSettings {
  const next: AppSettings = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    const theme = (raw as Partial<AppSettings>).theme
    if (isThemePref(theme)) next.theme = theme
  }
  return next
}

/**
 * 启动时读一次。文件不存在 = 首次运行，静默用默认值；
 * 文件在但解析不了 = 另一种情况，必须留一行日志区分开——
 * 两者的表现都是"设置没了"，只有日志能说明是哪一种。
 */
export function loadSettings(): AppSettings {
  const file = settingsFile()
  if (!existsSync(file)) {
    current = { ...DEFAULTS }
    return current
  }
  try {
    current = sanitize(JSON.parse(readFileSync(file, 'utf-8')))
  } catch (error) {
    console.warn(`[settings] ${file} 解析失败，本轮用默认值（原因：${String(error)}）`)
    current = { ...DEFAULTS }
  }
  return current
}

export function getSettings(): AppSettings {
  return { ...current }
}

/** 只认已知键，且值要过判定；其余一律不采信也不落盘。返回合并后的全量设置。 */
export function patchSettings(patch: unknown): AppSettings {
  if (patch && typeof patch === 'object') {
    const theme = (patch as Partial<AppSettings>).theme
    if (isThemePref(theme)) current = { ...current, theme }
  }
  try {
    writeFileSync(settingsFile(), JSON.stringify(current, null, 2), 'utf-8')
  } catch (error) {
    // 写不盘只影响"下次启动还记得吗"，当前这轮改动照样生效，所以不抛出、但要留痕。
    console.warn(`[settings] 写盘失败，当前会话内仍然生效（原因：${String(error)}）`)
  }
  return getSettings()
}

/**
 * 主进程侧的生效动作：`themeSource` 一旦设好，`nativeTheme.shouldUseDarkColors`
 * 就成了单一真值——light/dark 档把它钉死，system 档让它跟着操作系统走。
 *
 * 钉死有个副作用要处理：`shouldUseDarkColors` 之后反映的是**覆盖值**而不是操作系统，
 * 于是"系统：深色"这种文案会在浅色档下谎报系统。所以在改 themeSource 之前先记一次真实
 * 偏好（此刻 themeSource 还是出厂默认的 'system'），之后只在 system 档刷新它。
 */
let observedSystemDark = false

export function applyThemeSource(settings: AppSettings = current): void {
  if (nativeTheme.themeSource === 'system') observedSystemDark = nativeTheme.shouldUseDarkColors
  nativeTheme.themeSource = settings.theme
}

export function themeSnapshot(settings: AppSettings = current): ThemeSnapshot {
  const live = nativeTheme.shouldUseDarkColors
  // system 档：live 就是操作系统的偏好，顺手刷新记录；钉住档位：用最后一次真实记录。
  if (settings.theme === 'system') observedSystemDark = live
  const systemDark = settings.theme === 'system' ? live : observedSystemDark
  return {
    pref: settings.theme,
    effective: resolveEffectiveTheme(settings.theme, systemDark),
    systemDark
  }
}
