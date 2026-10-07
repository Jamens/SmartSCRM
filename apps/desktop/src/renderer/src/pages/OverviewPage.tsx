// src/renderer/src/pages/OverviewPage.tsx
// B24 首页概览：套餐信息卡 + 快捷入口网格 + 平台在线盘点卡 + 数据摘要卡 + 用量统计卡。
// 数据来源：套餐/用量来自 /api/tenant/info（B12 用量模型），平台在线来自 /api/platform-accounts，
// 数据摘要来自 /api/dashboard/overview（B11）。席位已用数用仪表盘账号总数合并。
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Coins, CreditCard, LayoutGrid, Server, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDashboard } from '@/api/dashboard'
import { useTenantInfo } from '@/api/tenant'
import { useAccounts } from '@/stores/accounts'
import { usePlanDialog } from '@/stores/planDialog'
import PlanActivateDialog from '@/components/PlanActivateDialog'
import { NAV_ITEMS } from '@/lib/nav'
import { PLATFORMS } from '@/lib/platform'

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }): React.JSX.Element {
  const unlimited = limit == null
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {used}
          <span className="text-muted-foreground"> / {unlimited ? '∞' : limit}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={unlimited ? 'h-full rounded-full bg-primary/40' : 'h-full rounded-full bg-primary'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function OverviewPage(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: tenant } = useTenantInfo()
  const { data: dash } = useDashboard(7)
  const { data: accounts } = useAccounts()
  const openPlan = usePlanDialog((s) => s.openPlan)

  const byPlatform = useMemo(() => {
    const map = new Map<number, { online: number; total: number }>()
    for (const a of accounts ?? []) {
      const e = map.get(a.platformType) ?? { online: 0, total: 0 }
      e.total += 1
      if (a.status === 1) e.online += 1
      map.set(a.platformType, e)
    }
    return [...map.entries()].map(([type, v]) => ({ type, ...v }))
  }, [accounts])

  const summary = [
    { key: 'accounts', label: t('dashboard.accounts'), value: dash?.accountsOnline ?? 0, sub: `${t('dashboard.of')} ${dash?.accountsTotal ?? 0}` },
    { key: 'customers', label: t('dashboard.customers'), value: dash?.customersTotal ?? 0, sub: '' },
    { key: 'messages', label: t('dashboard.messages'), value: dash?.messageTotal ?? 0, sub: '' },
    { key: 'tasks', label: t('dashboard.tasks'), value: dash?.tasksTotal ?? 0, sub: t('dashboard.runningTasks', { count: dash?.tasksRunning ?? 0 }) }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <LayoutGrid className="size-5 text-primary" />
          {t('overview.title')}
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 套餐信息卡 */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Coins className="size-4 text-primary" />
            <CardTitle className="text-base">{t('overview.plan')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium">{tenant?.name ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                {tenant?.planName ? t(`plan.${tenant.planName}`) : t('overview.defaultPlan')}
              </p>
            </div>
            <UsageBar label={t('overview.seats')} used={dash?.accountsTotal ?? 0} limit={tenant?.seatLimit ?? null} />
          </CardContent>
        </Card>

        {/* 数据摘要卡 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <TrendingUp className="size-4 text-primary" />
            <CardTitle className="text-base">{t('dashboard.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {summary.map(({ key, label, value, sub }) => (
                <div key={key}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
                  {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 平台在线盘点卡 */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Server className="size-4 text-primary" />
            <CardTitle className="text-base">{t('overview.platform')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byPlatform.length === 0 && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
            {byPlatform.map(({ type, online, total }) => {
              const meta = PLATFORMS[type as keyof typeof PLATFORMS]
              const Icon = meta?.icon
              return (
                <div key={type} className="flex items-center gap-2 text-sm">
                  {Icon && <Icon className="size-4 text-muted-foreground" />}
                  <span className="flex-1">{meta?.label ?? `P${type}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {online}/{total}
                  </span>
                  <span className={online > 0 ? 'size-2 rounded-full bg-primary' : 'size-2 rounded-full bg-muted-foreground/40'} />
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* 用量统计卡 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Coins className="size-4 text-primary" />
            <CardTitle className="text-base">{t('overview.usage')}</CardTitle>
            <Button size="sm" variant="outline" className="ml-auto" onClick={openPlan}>
              <CreditCard className="size-3.5" />
              {t('plan.upgrade')}
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <UsageBar label={t('overview.seats')} used={dash?.accountsTotal ?? 0} limit={tenant?.seatLimit ?? null} />
            <UsageBar label={t('overview.aiTokens')} used={tenant?.aiTokenUsed ?? 0} limit={tenant?.aiTokenLimit ?? null} />
            <UsageBar label={t('overview.translationChars')} used={tenant?.translationCharUsed ?? 0} limit={tenant?.translationCharLimit ?? null} />
          </CardContent>
        </Card>
      </div>

      {/* 快捷入口网格 */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t('overview.quickEntry')}</CardTitle>
          <CardDescription>{t('overview.quickEntryDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
                >
                  <Icon className="size-5 text-primary" />
                  <span className="text-xs">{t(item.i18nKey)}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <PlanActivateDialog />
    </div>
  )
}
