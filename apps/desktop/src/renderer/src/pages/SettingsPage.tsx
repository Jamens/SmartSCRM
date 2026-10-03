import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BellRing,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Languages,
  LoaderCircle,
  MessageSquare,
  Monitor,
  MonitorSmartphone,
  Moon,
  Palette,
  Sun
} from 'lucide-react'
import { useUnreadTotal } from '@/api/messages'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDeviceInfo } from '@/lib/deviceInfo'
import { useAuthStore } from '@/stores/auth'
import {
  applyThemeClass,
  loadThemeState,
  setThemePref,
  watchThemeState,
  type ThemeUiState
} from '@/lib/theme'
import { useBadgeEnabled } from '@/lib/unreadBadge'
import { useNotifyEnabled } from '@/lib/desktopNotify'
import { useGpuFatal, useGpuSettings } from '@/lib/gpu'
import { useLanguage } from '@/lib/language'
import { changePassword } from '@/api/auth'
import { API_BASE, ApiError } from '@/lib/http'
import { cn } from '@/lib/utils'
import { SUPPORTED_LOCALES, type LocaleCode } from '@shared/i18n'
import type { ThemePref } from '@shared/theme'

const THEME_OPTIONS: Array<{ pref: ThemePref; labelKey: string; hintKey: string; icon: typeof Sun }> = [
  { pref: 'light', labelKey: 'settings.themeLight', hintKey: 'settings.themeLightHint', icon: Sun },
  { pref: 'dark', labelKey: 'settings.themeDark', hintKey: 'settings.themeDarkHint', icon: Moon },
  {
    pref: 'system',
    labelKey: 'settings.themeSystem',
    hintKey: 'settings.themeSystemHint',
    icon: MonitorSmartphone
  }
]

export default function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const lang = useLanguage()
  const [state, setState] = useState<ThemeUiState | null>(null)
  const [busy, setBusy] = useState<ThemePref | null>(null)
  const badge = useBadgeEnabled()
  // 桌面通知（A17）。与角标是**两个独立开关**：关掉角标不该把弹窗一起关掉。
  const notify = useNotifyEnabled()
  // 图形降级（A18）。开关与崩溃状态都只在主进程落盘，这里只是它的一个客户端。
  const gpu = useGpuSettings()
  const gpuFatal = useGpuFatal()
  // 卡片上那行现状读的是角标自己那份查询（同一个缓存键，不会多打一次请求）。
  const unread = useUnreadTotal()
  const device = useDeviceInfo()
  const user = useAuthStore((s) => s.user)
  // 当前身份直接读 store：这台机器上"登的是谁"只有一个来源，多一条查询就多一次说不一致的机会。
  const who = user
    ? `${user.nickname || user.username}（${user.role}）· 租户 ${user.tenantName} · 邀请码 ${user.inviteCode}`
    : '未登录'

  // 修改密码（A9）。改密成功后清掉本机会话，App 在 phase==='anonymous' 时自动渲染登录页。
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState(false)

  const submitPassword = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setPwErr(null)
    setPwOk(false)
    if (newPwd.length < 8) {
      setPwErr(t('settings.errPwdTooShort'))
      return
    }
    if (newPwd !== confirmPwd) {
      setPwErr(t('settings.errPwdMismatch'))
      return
    }
    setPwBusy(true)
    try {
      await changePassword({ oldPassword: oldPwd, newPassword: newPwd })
      setPwOk(true)
      // 清掉本机会话强制重登：App 在 phase==='anonymous' 时自动渲染登录页，无需手动导航。
      void useAuthStore.getState().logout()
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.message : t('settings.errPwdFailed'))
    } finally {
      setPwBusy(false)
    }
  }

  useEffect(() => {
    void loadThemeState().then(setState)
    // 订阅是必需的：主进程广播说明它已经改过窗口底色与 nativeTheme，
    // 页面不跟着刷新就会出现"按钮还亮着浅色、整页已经深色"。
    return watchThemeState((next) => {
      setState(next)
      applyThemeClass(next.effective)
    })
  }, [])

  const choose = async (pref: ThemePref): Promise<void> => {
    if (busy) return
    setBusy(pref)
    try {
      setState(await setThemePref(pref))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Palette className="size-5 text-primary" />
            {t('settings.title')}
          </h1>
          <p className="text-xs text-muted-foreground">
            {state
              ? t('settings.statusLine', {
                  effective: state.effective === 'dark' ? t('settings.effectiveDark') : t('settings.effectiveLight'),
                  system: state.systemDark ? t('settings.effectiveDark') : t('settings.effectiveLight'),
                  host: state.host === 'electron' ? t('settings.storedLocal') : t('settings.storedBrowser')
                })
              : t('common.reading')}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="flex max-w-3xl flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="size-4 text-primary" />
                {t('settings.language')}
              </CardTitle>
              <CardDescription>{t('settings.languageDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Label htmlFor="lang-select">{t('settings.languageLabel')}</Label>
              <select
                id="lang-select"
                value={lang.language}
                onChange={(e) => lang.setLanguage(e.target.value as LocaleCode)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                data-testid="lang-select"
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc.code} value={loc.code}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>外观</CardTitle>
              <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map(({ pref, labelKey, hintKey, icon: Icon }) => {
                const active = state?.pref === pref
                return (
                  <button
                    key={pref}
                    type="button"
                    title={t(hintKey)}
                    disabled={busy !== null}
                    onClick={() => void choose(pref)}
                    className={cn(
                      'flex min-w-32 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                      active
                        ? 'border-primary bg-primary/10 font-semibold text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                      busy === pref && 'opacity-60'
                    )}
                  >
                    <Icon className="size-4" />
                    {t(labelKey)}
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="size-4 text-primary" />
                {t('settings.notifications')}
              </CardTitle>
              <CardDescription>{t('settings.badgeDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('settings.badgeTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.badgeDetail')}</p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="badge-status">
                  {badge.host === 'browser'
                    ? t('settings.badgeStatusBrowser')
                    : unread.data
                      ? t('settings.badgeStatusNow', {
                          total: unread.data.total,
                          conversations: unread.data.conversations
                        })
                      : t('settings.badgeStatusLoading')}
                </p>
              </div>
              <Switch
                aria-label={t('settings.badgeTitle')}
                checked={badge.enabled}
                onCheckedChange={(v) => badge.setEnabled(v === true)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                {t('settings.desktopNotify')}
              </CardTitle>
              <CardDescription>{t('settings.desktopNotifyDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('settings.desktopNotifyTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.desktopNotifyDetail')}</p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="notify-status">
                  {notify.host === 'browser'
                    ? t('settings.desktopNotifyBrowser')
                    : notify.enabled
                      ? t('settings.enabled')
                      : t('settings.disabled')}
                </p>
              </div>
              <Switch
                aria-label={t('settings.desktopNotify')}
                checked={notify.enabled}
                onCheckedChange={(v) => notify.setEnabled(v === true)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                {t('settings.accountSecurity')}
              </CardTitle>
              <CardDescription>{t('settings.accountSecurityDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitPassword} className="flex max-w-sm flex-col gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="old-pwd">{t('settings.oldPassword')}</Label>
                  <Input
                    id="old-pwd"
                    type={showPwd ? 'text' : 'password'}
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    autoComplete="current-password"
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-pwd">{t('settings.newPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="new-pwd"
                      type={showPwd ? 'text' : 'password'}
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      autoComplete="new-password"
                      className="h-10 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={t('settings.togglePwdVisible')}
                    >
                      {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pwd">{t('settings.confirmPassword')}</Label>
                  <Input
                    id="confirm-pwd"
                    type={showPwd ? 'text' : 'password'}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    autoComplete="new-password"
                    className="h-10"
                    required
                  />
                </div>

                {pwErr && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    data-testid="pw-error"
                  >
                    {pwErr}
                  </p>
                )}
                {pwOk && (
                  <p
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600"
                    data-testid="pw-ok"
                  >
                    {t('settings.pwdChanged')}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={pwBusy}
                  className="h-10 w-fit bg-gradient-to-r from-primary to-[#2f5fe0] font-semibold shadow-lg shadow-primary/30 hover:ring-2 hover:ring-gold/60"
                >
                  {pwBusy ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" /> {t('settings.submitting')}
                    </>
                  ) : (
                    t('settings.changePassword')
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="size-4 text-primary" />
                {t('settings.graphics')}
              </CardTitle>
              <CardDescription>{t('settings.graphicsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('settings.hardwareAccel')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.hardwareAccelDetail')}</p>
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="gpu-status">
                    {gpu.host === 'browser'
                      ? t('settings.accelBrowser')
                      : gpu.hardwareAcceleration
                        ? t('settings.accelOn')
                        : t('settings.accelOff')}
                  </p>
                </div>
                <Switch
                  aria-label={t('settings.hardwareAccel')}
                  checked={gpu.hardwareAcceleration}
                  disabled={gpu.host === 'browser'}
                  onCheckedChange={(v) => gpu.setHardwareAcceleration(v === true)}
                />
              </div>

              {gpu.host === 'browser' ? null : gpu.gpuSafeMode ? (
                <div
                  className="rounded-lg border border-border bg-muted p-3 text-xs"
                  data-testid="gpu-safe-note"
                >
                  <p className="font-medium text-foreground">{t('settings.safeModeTitle')}</p>
                  <p className="mt-1 text-muted-foreground">
                    {gpuFatal
                      ? t('settings.safeModeFatal', { reason: gpuFatal.reason })
                      : t('settings.safeModeRecover')}
                  </p>
                  <button
                    type="button"
                    onClick={() => gpu.retryStandard()}
                    className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    data-testid="gpu-retry"
                  >
                    {t('settings.retryStandard')}
                  </button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-primary" />
                {t('settings.deviceInfo')}
              </CardTitle>
              <CardDescription>{t('settings.deviceInfoDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {device.loading ? (
                // 没取到之前不画那一排：先闪一排「未知」再闪回真值，读起来像数据在抖。
                <p className="text-xs text-muted-foreground" data-testid="device-loading">
                  {t('settings.deviceLoading')}
                </p>
              ) : (
                <dl
                  className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-1.5 text-xs"
                  data-testid="device-rows"
                >
                  {device.rows.map((row) => (
                    <div key={row.key} className="contents" data-device-key={row.key}>
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="min-w-0 break-all font-mono text-foreground select-text">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-xs text-muted-foreground">
                {t('settings.deviceLogin', { who, api: API_BASE })}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
