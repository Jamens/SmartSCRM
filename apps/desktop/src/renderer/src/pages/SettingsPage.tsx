import { useEffect, useState } from 'react'
import { MonitorSmartphone, Moon, Palette, Sun } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  applyThemeClass,
  loadThemeState,
  setThemePref,
  watchThemeState,
  type ThemeUiState
} from '@/lib/theme'
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
        </div>
      </div>
    </div>
  )
}
