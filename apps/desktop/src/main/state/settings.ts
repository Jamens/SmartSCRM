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
  /** 任务栏未读角标的总开关（Windows 红点 / mac/Linux 数字都归它管）。 */
  badgeEnabled: boolean
}

/** 交给渲染层的完整快照：`effective` 由主进程解析，页面只负责挂类名。 */
export interface ThemeSnapshot {
  pref: ThemePref
  effective: EffectiveTheme
  systemDark: boolean
}

const DEFAULTS: AppSettings = { theme: 'system', badgeEnabled: true }

const settingsFile = (): string => join(app.getPath('userData'), 'scrm-settings.json')

let current: AppSettings = { ...DEFAULTS }

/**
 * 逐键校验后并进 base：未知键、类型不对的值一律不采信（也就不落盘）。
 * 读盘与 `settings:set` 共用它——两处各写一份判定的话，加第三个设置项时一定会漏掉一处，
 * 而漏掉的那处的表现是"这个键能被写进文件，但没人读得回来"。
 */
function mergeKnown(base: AppSettings, raw: unknown): AppSettings {
  const next: AppSettings = { ...base }
  if (raw && typeof raw === 'object') {
    const patch = raw as Partial<AppSettings>
    if (isThemePref(patch.theme)) next.theme = patch.theme
    // 开关只认真布尔：`0` / `'false'` 这类"看着像假"的值不采信，否则一个布尔项会悄悄变成三态。
    if (typeof patch.badgeEnabled === 'boolean') next.badgeEnabled = patch.badgeEnabled
  }
  return next
}

function sanitize(raw: unknown): AppSettings {
  return mergeKnown({ ...DEFAULTS }, raw)
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
  current = mergeKnown(current, patch)
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
