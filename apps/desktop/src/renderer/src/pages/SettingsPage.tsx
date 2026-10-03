import { useEffect, useState, type FormEvent } from 'react'
import { BellRing, Eye, EyeOff, HardDrive, KeyRound, LoaderCircle, MessageSquare, Monitor, MonitorSmartphone, Moon, Palette, Sun } from 'lucide-react'
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
import { changePassword } from '@/api/auth'
import { API_BASE, ApiError } from '@/lib/http'
import { cn } from '@/lib/utils'
import type { ThemePref } from '@shared/theme'

const OPTIONS: Array<{ pref: ThemePref; label: string; hint: string; icon: typeof Sun }> = [
  { pref: 'light', label: '浅色', hint: '始终用亮色令牌', icon: Sun },
  { pref: 'dark', label: '深色', hint: '始终用暗色令牌', icon: Moon },
  { pref: 'system', label: '跟随系统', hint: '操作系统改档位时这里跟着改', icon: MonitorSmartphone }
]

export default function SettingsPage(): React.JSX.Element {
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
      setPwErr('新密码至少 8 位')
      return
    }
    if (newPwd !== confirmPwd) {
      setPwErr('两次输入的新密码不一致')
      return
    }
    setPwBusy(true)
    try {
      await changePassword({ oldPassword: oldPwd, newPassword: newPwd })
      setPwOk(true)
      // 清掉本机会话强制重登：App 在 phase==='anonymous' 时自动渲染登录页，无需手动导航。
      void useAuthStore.getState().logout()
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.message : '修改失败，请重试')
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
            设置
          </h1>
          <p className="text-xs text-muted-foreground">
            {state
              ? `生效：${state.effective === 'dark' ? '深色' : '浅色'} · 系统：${
                  state.systemDark ? '深色' : '浅色'
                } · 档位存于${state.host === 'electron' ? '本机设置文件' : '浏览器预览（不落盘）'}`
              : '读取设置中…'}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="flex max-w-3xl flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>外观</CardTitle>
              <CardDescription>
                只影响本应用的数据界面；内嵌的第三方页面（WhatsApp Web 等）由它们自己决定配色，
                不跟随这里的档位。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {OPTIONS.map(({ pref, label, hint, icon: Icon }) => {
                const active = state?.pref === pref
                return (
                  <button
                    key={pref}
                    type="button"
                    title={hint}
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
                    {label}
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="size-4 text-primary" />
                通知
              </CardTitle>
              <CardDescription>
                任务栏角标只统计本账号租户的未读，开关存在本机设置文件里。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">任务栏未读角标</p>
                <p className="text-xs text-muted-foreground">
                  窗口不在前台时，把未读消息总数标到任务栏图标上：Windows 是图标右下角的红点
                  （那个平台的接口画不了数字），macOS 与 Linux 是数字角标。
                  正在用这个应用时不显示——那时未读正在被读掉，挂上去的数下一秒就过期。
                </p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="badge-status">
                  {badge.host === 'browser'
                    ? '当前宿主不画任务栏角标（浏览器预览）'
                    : unread.data
                      ? `现在：未读 ${unread.data.total} 条，分布在 ${unread.data.conversations} 个会话`
                      : '未读取中…'}
                </p>
              </div>
              <Switch
                aria-label="任务栏未读角标"
                checked={badge.enabled}
                onCheckedChange={(v) => badge.setEnabled(v === true)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                桌面消息通知
              </CardTitle>
              <CardDescription>
                与任务栏角标是两个独立的开关：关掉一个不会牵连另一个。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">收到消息时弹系统通知</p>
                <p className="text-xs text-muted-foreground">
                  窗口不在前台时，收到的消息会弹一条系统通知；点它会回到这个应用并打开对应会话。
                  同一个会话连着来好几条会并成一条（标题上带条数），不会刷屏。
                  正在用这个应用时不弹——那时你已经在看了。
                </p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="notify-status">
                  {notify.host === 'browser'
                    ? '当前宿主弹不出系统通知（浏览器预览）'
                    : notify.enabled
                      ? '已开启'
                      : '已关闭'}
                </p>
              </div>
              <Switch
                aria-label="桌面消息通知"
                checked={notify.enabled}
                onCheckedChange={(v) => notify.setEnabled(v === true)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                账户安全
              </CardTitle>
              <CardDescription>
                修改登录密码。改密成功后当前登录会立即失效，需要用新密码重新登录。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitPassword} className="flex max-w-sm flex-col gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="old-pwd">原密码</Label>
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
                  <Label htmlFor="new-pwd">新密码</Label>
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
                      aria-label="切换密码可见"
                    >
                      {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pwd">确认新密码</Label>
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
                    密码已修改，正在退出登录…
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={pwBusy}
                  className="h-10 w-fit bg-gradient-to-r from-primary to-[#2f5fe0] font-semibold shadow-lg shadow-primary/30 hover:ring-2 hover:ring-gold/60"
                >
                  {pwBusy ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" /> 提交中…
                    </>
                  ) : (
                    '修改密码'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="size-4 text-primary" />
                图形
              </CardTitle>
              <CardDescription>
                硬件加速用 GPU 渲染界面，更流畅；出问题时可以关掉改用软件渲染。改动需重启生效，
                应用会自己重启一次以切换到新的渲染后端。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">硬件加速</p>
                  <p className="text-xs text-muted-foreground">
                    关掉后用软件渲染（CPU）跑界面，更稳但更费电。部分老显卡驱动会崩 GPU
                    进程，那时应用会自动切到这个模式并提醒你。
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="gpu-status">
                    {gpu.host === 'browser'
                      ? '当前宿主（浏览器预览）没有 GPU 后端可切换'
                      : gpu.hardwareAcceleration
                        ? '已开启（使用 GPU）'
                        : '已关闭（软件渲染）'}
                  </p>
                </div>
                <Switch
                  aria-label="硬件加速"
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
                  <p className="font-medium text-foreground">当前处于图形降级模式</p>
                  <p className="mt-1 text-muted-foreground">
                    {gpuFatal
                      ? `降级模式下 GPU 仍崩溃（原因：${gpuFatal.reason}），多半是显卡驱动问题，建议更新驱动。`
                      : '上次启动因 GPU 进程崩溃被自动切到这里。可以尝试恢复正常模式：'}
                  </p>
                  <button
                    type="button"
                    onClick={() => gpu.retryStandard()}
                    className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    data-testid="gpu-retry"
                  >
                    重试标准模式
                  </button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-primary" />
                设备信息
              </CardTitle>
              <CardDescription>
                这台机器与这个应用的现状。机器码与系统版本按登录时上报后端 `device`
                那份口径取，所以卡片上写的与库里存的应当是同一串。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {device.loading ? (
                // 没取到之前不画那一排：先闪一排「未知」再闪回真值，读起来像数据在抖。
                <p className="text-xs text-muted-foreground" data-testid="device-loading">
                  读取中…
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
                当前登录：<span data-testid="device-identity">{who}</span> · 服务地址{' '}
                <span data-testid="device-api" className="font-mono select-text">
                  {API_BASE}
                </span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
