import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, Cloud, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useCloudAccounts,
  useCloudAccountGroups,
  useCloudAccountMutations,
  useCloudAccountGroupMutations,
  type CloudAccount,
  type CloudAccountPlatform,
  type CloudAccountStatus,
  type CloudAccountUpsert
} from '@/api/cloudAccount'

const PLATFORMS: CloudAccountPlatform[] = ['whatsapp', 'telegram', 'line']
const STATUSES: CloudAccountStatus[] = ['online', 'offline', 'warming', 'banned']
const STAT_KEYS = ['total', 'online', 'warming', 'offline', 'banned'] as const

/**
 * B21 云账号池：分组 / 统计卡 / 批量转移 / 筛选 / 同步到本地。
 *
 * - 统计卡：按状态汇总（总数 / 在线 / 养号中 / 离线 / 已封禁）。
 * - 筛选：分组 + 状态 + 关键字（名称或号码），纯前端对已拉到的列表过滤。
 * - 批量转移：勾选多行 → 选目标分组 → 整体挪过去（groupId 为空 = 移出分组）。
 * - 同步到本地：把云号落成一条本地 platform_account 记录，并回写同步时间。
 *
 * 开源红线：「同步到本地」只是后端写一条本地账号记录（不接真实号源、不发起任何外连），
 * 本页只负责触发与展示同步结果，与 B13 模拟出口探测 / B14 模拟生成指纹同口径。
 */
export default function CloudAccountPage(): React.JSX.Element {
  const { t } = useTranslation()
  const list = useCloudAccounts()
  const groups = useCloudAccountGroups()
  const m = useCloudAccountMutations()
  const gm = useCloudAccountGroupMutations()

  const rows = useMemo<CloudAccount[]>(() => list.data ?? [], [list.data])
  const groupRows = useMemo(() => groups.data ?? [], [groups.data])

  const [sel, setSel] = useState<Set<number>>(new Set())
  const [filterGroup, setFilterGroup] = useState('') // ''=全部；'none'=未分组
  const [filterStatus, setFilterStatus] = useState('')
  const [kw, setKw] = useState('')
  const [targetGroup, setTargetGroup] = useState('')

  const [editing, setEditing] = useState<CloudAccount | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [platform, setPlatform] = useState<CloudAccountPlatform>('whatsapp')
  const [status, setStatus] = useState<CloudAccountStatus>('offline')
  const [groupId, setGroupId] = useState('')
  const [remark, setRemark] = useState('')

  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')

  const [confirming, setConfirming] = useState<{ kind: 'account' | 'group'; id: number } | null>(null)

  const stats = useMemo(() => ({
    total: rows.length,
    online: rows.filter((a) => a.status === 'online').length,
    warming: rows.filter((a) => a.status === 'warming').length,
    offline: rows.filter((a) => a.status === 'offline').length,
    banned: rows.filter((a) => a.status === 'banned').length
  }), [rows])

  const filtered = useMemo(() => rows.filter((a) => {
    if (filterGroup === 'none' && a.groupId != null) return false
    if (filterGroup !== '' && filterGroup !== 'none' && a.groupId !== Number(filterGroup)) return false
    if (filterStatus !== '' && a.status !== filterStatus) return false
    const q = kw.trim().toLowerCase()
    if (q && !a.name.toLowerCase().includes(q) && !(a.phone ?? '').toLowerCase().includes(q)) return false
    return true
  }), [rows, filterGroup, filterStatus, kw])

  const groupNameOf = (id: number | null): string =>
    id == null ? t('cloudaccount.table.ungrouped') : (groupRows.find((g) => g.id === id)?.name ?? '—')

  const openCreate = (): void => {
    setEditing(null)
    setCreating(true)
    setName('')
    setPhone('')
    setPlatform('whatsapp')
    setStatus('offline')
    setGroupId(filterGroup !== '' && filterGroup !== 'none' ? filterGroup : '')
    setRemark('')
  }

  const openEdit = (a: CloudAccount): void => {
    setCreating(false)
    setEditing(a)
    setName(a.name)
    setPhone(a.phone ?? '')
    setPlatform(a.platform)
    setStatus(a.status)
    setGroupId(a.groupId == null ? '' : String(a.groupId))
    setRemark(a.remark ?? '')
  }

  const closeForm = (): void => {
    setCreating(false)
    setEditing(null)
  }

  const submit = (): void => {
    const body: CloudAccountUpsert = {
      name: name.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      platform,
      status,
      groupId: groupId === '' ? null : Number(groupId),
      remark: remark.trim() === '' ? null : remark.trim()
    }
    if (editing) {
      m.update.mutate({ id: editing.id, body }, { onSuccess: closeForm })
    } else {
      m.create.mutate(body, { onSuccess: closeForm })
    }
  }

  const toggleSel = (id: number): void => {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doTransfer = (): void => {
    const ids = [...sel]
    if (ids.length === 0) return
    m.transfer.mutate({ ids, groupId: targetGroup === '' ? null : Number(targetGroup) }, {
      onSuccess: () => setSel(new Set())
    })
  }

  const doDelete = (): void => {
    if (!confirming) return
    if (confirming.kind === 'account') m.remove.mutate(confirming.id)
    else gm.remove.mutate(confirming.id)
    setConfirming(null)
  }

  const selectCls = 'rounded-md border border-border/60 bg-background px-2 py-1 text-sm'

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Cloud className="size-4" />{t('cloudaccount.title')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('cloudaccount.desc')}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreatingGroup((v) => !v)} data-testid="ca-new-group">
            <Plus className="size-3.5" />{t('cloudaccount.newGroup')}
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="ca-new">
            <Plus className="size-3.5" />{t('cloudaccount.newAccount')}
          </Button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {STAT_KEYS.map((k) => (
          <div key={k} className="rounded-lg border border-border/60 bg-card px-3 py-2" data-testid={`ca-stat-${k}`}>
            <div className="text-xs text-muted-foreground">{t(`cloudaccount.stats.${k}`)}</div>
            <div className="text-lg font-semibold">{stats[k]}</div>
          </div>
        ))}
      </div>

      {/* 新建分组 */}
      {creatingGroup && (
        <Card>
          <CardContent className="flex items-end gap-2 pt-4">
            <div className="flex-1 space-y-1">
              <div className="text-xs text-muted-foreground">{t('cloudaccount.group.name')}</div>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} data-testid="cg-name" />
            </div>
            <Button size="sm" onClick={() => gm.create.mutate({ name: groupName.trim() }, {
              onSuccess: () => { setGroupName(''); setCreatingGroup(false) }
            })} data-testid="cg-submit">{t('cloudaccount.form.submit')}</Button>
          </CardContent>
        </Card>
      )}

      {/* 筛选 + 批量转移 */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('cloudaccount.filter.group')}</div>
          <select className={selectCls} value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)} data-testid="ca-filter-group">
            <option value="">{t('cloudaccount.filter.all')}</option>
            <option value="none">{t('cloudaccount.table.ungrouped')}</option>
            {groupRows.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('cloudaccount.filter.status')}</div>
          <select className={selectCls} value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)} data-testid="ca-filter-status">
            <option value="">{t('cloudaccount.filter.all')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`cloudaccount.status.${s}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('cloudaccount.filter.keyword')}</div>
          <Input value={kw} onChange={(e) => setKw(e.target.value)} data-testid="ca-filter-kw" />
        </div>
        <div className="ml-auto flex items-end gap-2">
          <span className="text-xs text-muted-foreground" data-testid="ca-batch-count">
            {t('cloudaccount.batch.selected', { count: sel.size })}
          </span>
          <select className={selectCls} value={targetGroup}
            onChange={(e) => setTargetGroup(e.target.value)} data-testid="ca-batch-target">
            <option value="">{t('cloudaccount.batch.ungrouped')}</option>
            {groupRows.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={sel.size === 0} onClick={doTransfer} data-testid="ca-batch-transfer">
            <ArrowRightLeft className="size-3.5" />{t('cloudaccount.batch.transfer')}
          </Button>
        </div>
      </div>

      {/* 云号表 */}
      <Card className="min-h-0 flex-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('cloudaccount.table.title')}</CardTitle>
          <CardDescription className="text-xs">{t('cloudaccount.table.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          {list.isLoading ? (
            <div className="text-xs text-muted-foreground">{t('cloudaccount.loading')}</div>
          ) : list.isError ? (
            <div className="text-xs text-destructive">{t('cloudaccount.loadFailed')}</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground" data-testid="ca-hint">
              {rows.length === 0 ? t('cloudaccount.table.empty') : t('cloudaccount.table.noMatch')}
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="ca-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.name')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.phone')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.platform')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.status')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.group')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('cloudaccount.table.synced')}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-border/40 last:border-0" data-testid={`ca-row-${a.id}`}>
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggleSel(a.id)}
                        data-testid={`ca-check-${a.id}`} />
                    </td>
                    <td className="px-2 py-2">{a.name}</td>
                    <td className="px-2 py-2 text-muted-foreground">{a.phone ?? '—'}</td>
                    <td className="px-2 py-2">{t(`cloudaccount.platform.${a.platform}`)}</td>
                    <td className="px-2 py-2">
                      <Badge variant={a.status === 'banned' ? 'destructive' : 'secondary'}>
                        {t(`cloudaccount.status.${a.status}`)}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground" data-testid={`ca-groupcell-${a.id}`}>
                      {groupNameOf(a.groupId)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground" data-testid={`ca-synced-${a.id}`}>
                      {a.syncedAt ? t('cloudaccount.table.syncedAt', { at: a.syncedAt }) : '—'}
                    </td>
                    <td className="flex justify-end gap-1 px-2 py-2">
                      <Button size="sm" variant="ghost" onClick={() => m.sync.mutate(a.id)}
                        disabled={m.sync.isPending} data-testid={`ca-sync-${a.id}`}>
                        <RefreshCw className="size-3.5" />{t('cloudaccount.table.sync')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(a)} data-testid={`ca-edit-${a.id}`}>
                        {t('cloudaccount.table.edit')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming({ kind: 'account', id: a.id })}
                        data-testid={`ca-del-${a.id}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 分组管理 */}
      {groupRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('cloudaccount.group.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {groupRows.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs"
                data-testid={`cg-row-${g.id}`}>
                {g.name}
                <button type="button" className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirming({ kind: 'group', id: g.id })} data-testid={`cg-del-${g.id}`}>×</button>
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 新建/编辑云号 */}
      {(creating || editing) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {editing ? t('cloudaccount.form.editTitle') : t('cloudaccount.form.createTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">{t('cloudaccount.form.name')}</div>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="ca-name" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">{t('cloudaccount.form.phone')}</div>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="ca-phone" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select className={selectCls} value={platform}
                onChange={(e) => setPlatform(e.target.value as CloudAccountPlatform)} data-testid="ca-platform">
                {PLATFORMS.map((p) => <option key={p} value={p}>{t(`cloudaccount.platform.${p}`)}</option>)}
              </select>
              <select className={selectCls} value={status}
                onChange={(e) => setStatus(e.target.value as CloudAccountStatus)} data-testid="ca-status">
                {STATUSES.map((s) => <option key={s} value={s}>{t(`cloudaccount.status.${s}`)}</option>)}
              </select>
              <select className={selectCls} value={groupId}
                onChange={(e) => setGroupId(e.target.value)} data-testid="ca-group">
                <option value="">{t('cloudaccount.table.ungrouped')}</option>
                {groupRows.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
              </select>
            </div>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder={t('cloudaccount.form.remark')} data-testid="ca-remark" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm} data-testid="ca-cancel">
                {t('cloudaccount.form.cancel')}
              </Button>
              <Button size="sm" onClick={submit} data-testid="ca-submit">{t('cloudaccount.form.submit')}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 删除二次确认 */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="ca-confirm">
          <div className="w-[320px] rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium">{t('cloudaccount.confirm.title')}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t('cloudaccount.confirm.desc')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming(null)} data-testid="ca-confirm-no">
                {t('cloudaccount.confirm.no')}
              </Button>
              <Button size="sm" variant="destructive" onClick={doDelete} data-testid="ca-confirm-yes">
                {t('cloudaccount.confirm.yes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
