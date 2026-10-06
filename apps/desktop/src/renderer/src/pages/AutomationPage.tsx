import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, PowerOff, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { platformOf } from '@/lib/platform'
import { useAutomationMutations, useAutomationOverview, type AutomationKind } from '@/api/automation'

/**
 * B20 本地自动化任务面板：跨模块只读聚合 + 账号批量操作。
 *
 * - 总览：账号/在线/任务/在跑 + 四类任务来源分布（数据来自 B8/B9/B18/B19 既有表，自身不新增表）。
 * - 账号表：批量勾选后「关闭」（停账号+停任务，可恢复）或「删除」。
 * - **删除二次确认**：先展示「将先停掉 N 个在跑任务，再删除账号，不可逆」，确认后才调接口；
 *   接口回包带 stoppedTasks，再展示实际停掉的任务数。人工门在 UI 上可见、可复核。
 */
export default function AutomationPage(): React.JSX.Element {
  const { t } = useTranslation()
  const ov = useAutomationOverview()
  const m = useAutomationMutations()
  const [selected, setSelected] = useState<number[]>([])
  // 二次确认：点关闭/删除后先进入预览态，确认才真正发请求。
  const [pending, setPending] = useState<null | { type: 'close' | 'delete'; ids: number[] }>(null)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  const accounts = ov.data?.accounts ?? []
  const selectedRows = useMemo(
    () => accounts.filter((a) => selected.includes(a.id)),
    [accounts, selected]
  )
  const tasksToStop = useMemo(
    () => selectedRows.reduce((n, a) => n + a.activeTasks, 0),
    [selectedRows]
  )

  const toggle = (id: number): void => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  const toggleAll = (): void => {
    setSelected((s) => (s.length === accounts.length ? [] : accounts.map((a) => a.id)))
  }

  const fire = (): void => {
    if (!pending) return
    const { type, ids } = pending
    const mutate = type === 'close' ? m.close : m.delete
    setResultMsg(null)
    mutate.mutate(ids, {
      onSuccess: (res) => {
        setResultMsg(
          type === 'delete'
            ? t('automation.confirm.done', { tasks: res.stoppedTasks ?? 0 })
            : t('automation.confirm.closeDone', { tasks: tasksToStop })
        )
        setPending(null)
        setSelected([])
      }
    })
  }

  const busy = m.close.isPending || m.delete.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Cpu className="size-5 text-primary" />
          {t('automation.title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('automation.desc')}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {/* 总览卡片 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="automation-overview">
          <div className="rounded-lg border border-border/60 bg-card p-3" data-testid="ov-accounts">
            <p className="text-xs text-muted-foreground">{t('automation.overview.accounts')}</p>
            <p className="mt-1 text-2xl font-semibold">{ov.data?.accountsTotal ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-3" data-testid="ov-online">
            <p className="text-xs text-muted-foreground">{t('automation.overview.online')}</p>
            <p className="mt-1 text-2xl font-semibold">{ov.data?.accountsOnline ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-3" data-testid="ov-tasks">
            <p className="text-xs text-muted-foreground">{t('automation.overview.tasks')}</p>
            <p className="mt-1 text-2xl font-semibold">{ov.data?.tasksTotal ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-3" data-testid="ov-active">
            <p className="text-xs text-muted-foreground">{t('automation.overview.active')}</p>
            <p className="mt-1 text-2xl font-semibold">{ov.data?.tasksActive ?? '—'}</p>
          </div>
        </div>

        {/* 任务来源分布 */}
        <div className="mt-3 flex flex-wrap gap-2" data-testid="automation-bykind">
          {(Object.entries(ov.data?.byKind ?? {}) as [AutomationKind, number][])
            .filter(([, n]) => n > 0)
            .map(([k, n]) => (
              <Badge key={k} variant="secondary" data-testid={`kind-${k}`}>
                {t(`automation.kind.${k}`)} · {n}
              </Badge>
            ))}
          {(ov.data?.tasksTotal ?? 0) === 0 && (
            <span className="text-xs text-muted-foreground">{t('automation.overview.none')}</span>
          )}
        </div>

        {resultMsg && (
          <p className="mt-3 rounded-md border border-border/60 bg-muted px-3 py-2 text-xs text-foreground" data-testid="automation-result">
            {resultMsg}
          </p>
        )}

        {/* 账号表 + 批量操作 */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t('automation.table.title')}</CardTitle>
            <CardDescription>{t('automation.table.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* 批量操作条 */}
            <div className="flex items-center gap-2" data-testid="automation-actions">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={selected.length > 0 && selected.length === accounts.length}
                  onChange={toggleAll} data-testid="automation-selectall" />
                {t('automation.table.selectAll')}
              </label>
              <span className="text-xs text-muted-foreground" data-testid="automation-selected">
                {t('automation.actions.selected', { count: selected.length })}
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" disabled={selected.length === 0 || busy}
                  onClick={() => setPending({ type: 'close', ids: selected })} data-testid="automation-close">
                  <PowerOff className="mr-1 size-3.5" />
                  {t('automation.actions.close')}
                </Button>
                <Button size="sm" variant="destructive" disabled={selected.length === 0 || busy}
                  onClick={() => setPending({ type: 'delete', ids: selected })} data-testid="automation-delete">
                  <Trash2 className="mr-1 size-3.5" />
                  {t('automation.actions.delete')}
                </Button>
              </div>
            </div>

            {/* 二次确认预览 */}
            {pending && (
              <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
                data-testid="automation-confirm">
                <p className="text-sm font-medium text-destructive">
                  {pending.type === 'delete'
                    ? t('automation.confirm.deleteTitle', { count: pending.ids.length })
                    : t('automation.confirm.closeTitle', { count: pending.ids.length })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pending.type === 'delete'
                    ? t('automation.confirm.deleteDesc', { count: pending.ids.length, tasks: tasksToStop })
                    : t('automation.confirm.closeDesc', { count: pending.ids.length, tasks: tasksToStop })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={busy}
                    onClick={fire} data-testid="automation-confirm-yes">
                    {pending.type === 'delete' ? t('automation.actions.deleteConfirm') : t('automation.actions.closeConfirm')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => setPending(null)} data-testid="automation-confirm-no">
                    {t('automation.actions.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {/* 账号表 */}
            <div className="overflow-hidden rounded-md border border-border/60" data-testid="automation-table">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2 text-left font-medium">{t('automation.table.account')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('automation.table.platform')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('automation.table.online')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('automation.table.tasks')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {accounts.map((a) => {
                    const meta = platformOf(a.platformType)
                    return (
                      <tr key={a.id} data-testid={`row-${a.id}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.includes(a.id)}
                            onChange={() => toggle(a.id)} data-testid={`check-${a.id}`} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{a.name}</span>
                          <span className="ml-1 text-xs text-muted-foreground">#{a.id}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{meta?.label ?? '—'}</td>
                        <td className="px-3 py-2">
                          {a.online
                            ? <Badge variant="default">{t('automation.table.online')}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {a.activeTasks > 0
                            ? <Badge variant="secondary">{a.activeTasks}</Badge>
                            : <span className="text-xs text-muted-foreground">0</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {accounts.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {t('automation.table.empty')}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
