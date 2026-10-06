import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Plus, Trash2, Wifi } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useProxyPool,
  useProxyPoolMutations,
  type ProxyPool,
  type ProxyProtocol,
  type ProxyStatus,
  type ProxyPoolUpsert
} from '@/api/proxyPool'

/**
 * B13 代理池：代理 CRUD + 模拟出口探测视图。
 *
 * - 代理表格（增删改查），状态徽章，出口探测结果（IP/归属地/延迟）。
 * - 选中代理 → 右侧看详情 + 「测试出口」按钮（会话出口 IP 探测 + 按 IP 查归属地）。
 * - 删除走二次确认（破坏性动作，与 B10 纪律一致）。
 *
 * 开源红线：出口探测是后端确定性模拟（不发起真实外连），本页只展示结果。
 */
export default function ProxyPoolPage(): React.JSX.Element {
  const { t } = useTranslation()
  const list = useProxyPool()
  const m = useProxyPoolMutations()
  const [sel, setSel] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDel, setPendingDel] = useState<number | null>(null)

  const rows = list.data ?? []
  const selected = rows.find((p) => p.id === sel) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Globe className="size-5 text-primary" />
            {t('proxypool.title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('proxypool.desc')}</p>
        </div>
        <Button size="sm" disabled={creating} onClick={() => { setCreating(true); setSel(null) }} data-testid="pp-new">
          <Plus className="mr-1 size-3.5" />{t('proxypool.newProxy')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
          {/* 代理表格 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('proxypool.table.title')}</CardTitle>
              <CardDescription>{t('proxypool.table.desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm" data-testid="pp-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">{t('proxypool.table.name')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('proxypool.table.endpoint')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('proxypool.table.protocol')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('proxypool.table.status')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('proxypool.table.egress')}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((p) => (
                    <tr key={p.id} data-testid={`pp-row-${p.id}`} className={sel === p.id ? 'bg-muted/40' : ''}>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:text-primary"
                          onClick={() => { setSel(p.id); setCreating(false) }} data-testid={`pp-select-${p.id}`}>
                          {p.name}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">{p.host}:{p.port}</td>
                      <td className="px-2 py-2 text-muted-foreground">{t(`proxypool.protocol.${p.protocol}`)}</td>
                      <td className="px-2 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-2 py-2 text-xs text-muted-foreground" data-testid={`pp-egress-${p.id}`}>
                        {p.egressIp
                          ? <span>{p.egressGeo} · {p.egressIp}{p.latencyMs != null ? ` · ${p.latencyMs}ms` : ''}</span>
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" className="text-primary hover:opacity-80 disabled:opacity-40"
                          disabled={m.test.isPending}
                          onClick={() => m.test.mutate(p.id)} data-testid={`pp-test-${p.id}`}>
                          <Wifi className="size-4" />
                        </button>
                        <button type="button" className="ml-2 text-destructive hover:opacity-80"
                          onClick={() => setPendingDel(p.id)} data-testid={`pp-del-${p.id}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {t('proxypool.table.empty')}</td></tr>
                  )}
                </tbody>
              </table>

              {/* 删除二次确认 */}
              {pendingDel != null && (
                <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2" data-testid="pp-confirm">
                  <p className="text-sm font-medium text-destructive">{t('proxypool.confirm.deleteTitle')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('proxypool.confirm.deleteDesc')}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="destructive" disabled={m.remove.isPending}
                      onClick={() => { m.remove.mutate(pendingDel); setPendingDel(null) }} data-testid="pp-confirm-yes">
                      {t('proxypool.confirm.yes')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={m.remove.isPending}
                      onClick={() => setPendingDel(null)} data-testid="pp-confirm-no">
                      {t('proxypool.confirm.no')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右栏：新建 / 详情+模拟出口探测 */}
          <div className="flex flex-col gap-4">
            {creating ? (
              <ProxyForm
                mode="create"
                onSubmit={(b) => { m.create.mutate(b, { onSuccess: () => setCreating(false) }) }}
                onCancel={() => setCreating(false)}
              />
            ) : selected ? (
              <>
                <ProxyDetail proxy={selected} onTest={() => m.test.mutate(selected.id)} testing={m.test.isPending} />
                <ProxyForm
                  mode="edit"
                  initial={selected}
                  onSubmit={(b) => m.update.mutate({ id: selected.id, body: b })}
                  onCancel={() => undefined}
                />
              </>
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground" data-testid="pp-hint">
                  {t('proxypool.table.selectHint')}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ProxyStatus }): React.JSX.Element {
  const map: Record<ProxyStatus, { v: 'default' | 'outline' | 'secondary' | 'destructive'; k: string }> = {
    online: { v: 'default', k: 'online' },
    degraded: { v: 'secondary', k: 'degraded' },
    offline: { v: 'outline', k: 'offline' },
    error: { v: 'destructive', k: 'error' }
  }
  const { v, k } = map[status] ?? map.offline
  return <Badge variant={v}>{k}</Badge>
}

const STATUSES: ProxyStatus[] = ['online', 'offline', 'error', 'degraded']
const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks5']

function ProxyForm({ mode, initial, onSubmit, onCancel }: {
  mode: 'create' | 'edit'
  initial?: ProxyPool
  onSubmit: (b: ProxyPoolUpsert) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? 1080))
  const [protocol, setProtocol] = useState<ProxyProtocol>(initial?.protocol ?? 'http')
  const [status, setStatus] = useState<ProxyStatus>(initial?.status ?? 'offline')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [remark, setRemark] = useState(initial?.remark ?? '')

  const submit = (): void => {
    if (!name.trim() || !host.trim()) return
    onSubmit({
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 1080,
      protocol,
      status,
      username: username.trim() || null,
      password: password.trim() || null,
      remark: remark.trim() || null
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'create' ? t('proxypool.form.createTitle') : t('proxypool.form.editTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('proxypool.form.name')} data-testid="pp-name" />
        <div className="flex gap-2">
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('proxypool.form.host')} className="flex-1" data-testid="pp-host" />
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="w-24" data-testid="pp-port" />
        </div>
        <div className="flex gap-2">
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as ProxyProtocol)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="pp-protocol">
            {PROTOCOLS.map((p) => <option key={p} value={p}>{t(`proxypool.protocol.${p}`)}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProxyStatus)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="pp-status">
            {STATUSES.map((s) => <option key={s} value={s}>{t(`proxypool.status.${s}`)}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('proxypool.form.username')} className="flex-1" data-testid="pp-username" />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('proxypool.form.password')} className="flex-1" data-testid="pp-password" />
        </div>
        <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t('proxypool.form.remark')} data-testid="pp-remark" />
        <div className="flex gap-2">
          <Button size="sm" disabled={!name.trim() || !host.trim()} onClick={submit} data-testid="pp-submit">{t('proxypool.form.submit')}</Button>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="pp-cancel">{t('proxypool.form.cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 选中代理的详情 + 模拟出口探测。探测是后端确定性模拟（不发起真实外连），展示出口 IP / 归属地 / 延迟。
 */
function ProxyDetail({ proxy, onTest, testing }: { proxy: ProxyPool; onTest: () => void; testing: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{proxy.name}</CardTitle>
        <CardDescription>{proxy.host}:{proxy.port}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <button type="button" onClick={onTest} disabled={testing}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
          data-testid={`pp-test-detail-${proxy.id}`}>
          <Wifi className="size-3.5" />{t('proxypool.detail.test')}
        </button>
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid={`pp-egress-detail-${proxy.id}`}>
          {proxy.egressIp ? (
            <div className="flex flex-col gap-1 text-muted-foreground">
              <span><span className="text-foreground/70">{t('proxypool.detail.egressIp')}:</span> {proxy.egressIp}</span>
              <span><span className="text-foreground/70">{t('proxypool.detail.geo')}:</span> {proxy.egressGeo}</span>
              <span><span className="text-foreground/70">{t('proxypool.detail.latency')}:</span> {proxy.latencyMs}ms</span>
              <span className="text-[10px] opacity-70">{t('proxypool.detail.simNote')}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t('proxypool.detail.notProbed')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
