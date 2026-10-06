import { app, nativeTheme } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { isLocaleCode, FALLBACK_LOCALE, type LocaleCode } from '@shared/i18n'
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
  /**
   * 桌面消息通知（A17）的总开关。
   * 与 `badgeEnabled` 是**两个独立开关**：角标管任务栏，通知管弹窗，关掉一个不该牵连另一个。
   */
  notificationEnabled: boolean
  /**
   * 硬件加速总开关。默认开（用 GPU 渲染）。
   * 关掉 = 软件渲染降级模式；这个改动**必须重启才生效**，主进程会带 `--gpu-safe-mode` 重启一次。
   * 不是「关掉就立刻变卡」——它改的是下一次启动的渲染后端。
   */
  hardwareAcceleration: boolean
  /**
   * 是否处于「GPU 进程崩溃后自动降级」状态。默认关。
   * true 表示上次启动因 GPU 进程崩溃而被自动降级，下次启动默认进降级。
   * 设置页「重试标准模式」会把它清回 false，并尝试回到标准渲染。
   */
  gpuSafeMode: boolean
  /**
   * 界面显示语言（A4）。值必须是 `SUPPORTED_LOCALES` 里的代码，否则不采信、回退默认值。
   * 渲染层在首帧前读它来初始化 i18next，改动即时生效并落盘。
   */
  language: LocaleCode
  /**
   * A6 自动更新的**自托管**更新清单 URL。默认空串 = 不检查、不外连（本仓是开源项目，
   * 绝不硬编码任何商业云端点）。由部署方/用户填自己的地址，填了才拉清单比版本。
   */
  updateManifestUrl: string
}

/** 交给渲染层的完整快照：`effective` 由主进程解析，页面只负责挂类名。 */
export interface ThemeSnapshot {
  pref: ThemePref
  effective: EffectiveTheme
  systemDark: boolean
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  badgeEnabled: true,
  notificationEnabled: true,
  hardwareAcceleration: true,
  gpuSafeMode: false,
  language: FALLBACK_LOCALE,
  updateManifestUrl: ''
}

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
    if (typeof patch.notificationEnabled === 'boolean') {
      next.notificationEnabled = patch.notificationEnabled
    }
    // 两个图形开关同口径：只认真布尔，不采信 `0` / `'false'` 这类"看着像假"的值。
    if (typeof patch.hardwareAcceleration === 'boolean') {
      next.hardwareAcceleration = patch.hardwareAcceleration
    }
    if (typeof patch.gpuSafeMode === 'boolean') {
      next.gpuSafeMode = patch.gpuSafeMode
    }
    // 语言只认清单里的代码：把任意字符串写进设置既没用，还会让回退逻辑失准。
    if (isLocaleCode(patch.language)) next.language = patch.language
    // 更新源只存字符串（默认空=不外连）；非字符串一律不采信。trim 掉首尾空白与换行。
    if (typeof patch.updateManifestUrl === 'string') {
      next.updateManifestUrl = patch.updateManifestUrl.trim()
    }
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
 * 重置为出厂默认值（存储管理「清除通用本地数据 / 全部重置」用）。
 * 只回写 `DEFAULTS` 并落盘——不删文件、不碰其它目录；主题/语言等偏好一并回到默认。
 */
export function resetSettings(): AppSettings {
  current = { ...DEFAULTS }
  try {
    writeFileSync(settingsFile(), JSON.stringify(current, null, 2), 'utf-8')
  } catch (error) {
    console.warn(`[settings] reset 写盘失败（原因：${String(error)}）`)
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
