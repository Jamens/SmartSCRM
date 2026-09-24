import { useEffect, useState } from 'react'
import { BellRing, MonitorSmartphone, Moon, Palette, Sun } from 'lucide-react'
import { useUnreadTotal } from '@/api/messages'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  applyThemeClass,
  loadThemeState,
  setThemePref,
  watchThemeState,
  type ThemeUiState
} from '@/lib/theme'
import { useBadgeEnabled } from '@/lib/unreadBadge'
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
  // 卡片上那行现状读的是角标自己那份查询（同一个缓存键，不会多打一次请求）。
  const unread = useUnreadTotal()

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
        </div>
      </div>
    </div>
  )
}
