import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Activity, Bot, MessageSquare, Users, Wallet } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useDashboard, useAccountStats } from '@/api/dashboard'
import { dashboardCsv } from '@shared/dashboard'

/**
 * B11 报表仪表盘（首页总览）。
 *
 * 指标全部来自 `/api/dashboard/overview`（租户级，一次调用）；7 天趋势用**纯 div 柱状**画，
 * 不引图表库——柱条高度按当日总量相对峰值归一，hover 出当天收发数。
 */
export default function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [days, setDays] = useState<7 | 30>(7)
  const { data, isPending } = useDashboard(days)
  const { data: accounts } = useAccountStats(days)

  // 导出：客户端拼 CSV（@shared/dashboard）→ Blob 下载，不经后端、不落应用目录。
  const exportCsv = (): void => {
    if (!data) return
    const csv = dashboardCsv(data, accounts ?? [])
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scrm-dashboard-${days}d.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (isPending) return <p className="p-6 text-xs text-muted-foreground">{t('common.loading')}</p>
  const d = data
  const peak = Math.max(1, ...(d?.perDay ?? []).map((p) => p.inCount + p.outCount))

  const cards = [
    { key: 'accounts', icon: Bot, label: t('dashboard.accounts'), value: d?.accountsOnline ?? 0, sub: `${t('dashboard.of')} ${d?.accountsTotal ?? 0}` },
    { key: 'customers', icon: Users, label: t('dashboard.customers'), value: d?.customersTotal ?? 0, sub: '' },
    { key: 'conversations', icon: MessageSquare, label: t('dashboard.conversations'), value: d?.conversationsTotal ?? 0, sub: t('dashboard.activeConversations', { count: d?.activeConversations ?? 0 }) },
    { key: 'tasks', icon: Wallet, label: t('dashboard.tasks'), value: d?.tasksTotal ?? 0, sub: t('dashboard.runningTasks', { count: d?.tasksRunning ?? 0 }) }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Activity className="size-5 text-primary" />
          {t('dashboard.title')}
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[7, 30].map((n) => (
              <button key={n} onClick={() => setDays(n as 7 | 30)}
                className={`rounded-md px-2.5 py-1 text-xs ${days === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                {t('dashboard.lastDays', { count: n })}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} data-testid="dash-export"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted">
            {t('dashboard.export')}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ key, icon: Icon, label, value, sub }) => (
          <Card key={key} data-testid={`dash-card-${key}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="size-4" />
                {label}
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
              {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('dashboard.trend')}</CardTitle>
          <CardDescription>{t('dashboard.trendDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1" style={{ height: 140 }} data-testid="dash-trend">
            {(d?.perDay ?? []).map((p) => {
              const total = p.inCount + p.outCount
              const h = Math.round((total / peak) * 120)
              return (
                <div key={p.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${p.day} · ${t('dashboard.in')} ${p.inCount} · ${t('dashboard.out')} ${p.outCount}`}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded bg-primary/70" style={{ height: Math.max(2, h) }}>
                    {p.outCount > 0 && <div className="w-full bg-primary/40" style={{ height: `${(p.outCount / Math.max(1, total)) * 100}%` }} />}
                  </div>
                  <span className="text-[9px] text-muted-foreground">{dayjs(p.day).format('M/D')}</span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-primary" />{t('dashboard.in')} {d?.messageIn ?? 0}</span>
            <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-primary/40" />{t('dashboard.out')} {d?.messageOut ?? 0}</span>
            <Badge variant="outline">{t('dashboard.total')} {d?.messageTotal ?? 0}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('dashboard.byAccount')}</CardTitle>
          <CardDescription>{t('dashboard.byAccountDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="dash-accounts">
            {(accounts ?? []).map((a) => (
              <li key={a.accountId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.accountName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('dashboard.in')} {a.messageIn} · {t('dashboard.out')} {a.messageOut} · {t('dashboard.activeConversations', { count: a.activeConversations })}
                  </span>
                </span>
                <Badge variant={a.online ? 'default' : 'outline'}>{a.online ? t('dashboard.online') : t('dashboard.offline')}</Badge>
                <span className="w-16 shrink-0 text-right text-xs font-medium">{a.messageIn + a.messageOut}</span>
              </li>
            ))}
            {(accounts ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('dashboard.noAccountData')}</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
