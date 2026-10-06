import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, NotebookPen, Plus, Tag, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCustomers, useLabelTree } from '@/api/customers'
import {
  useCustomerFollowUps,
  useCustomerLabelChanges,
  useCustomerFollowUpMutations,
  useCustomerBatchLabel,
  type FollowUpType
} from '@/api/customerFollowUp'

const TYPES: FollowUpType[] = ['note', 'call', 'email', 'meeting', 'other']

/**
 * B23 客户跟进记录：跟进记录 + 标签变更记录 + 统计卡 / 批量操作条。
 *
 * - 统计卡：客户总数 / 跟进记录数 / 待跟进（有提醒时间的）/ 标签变更数。
 * - 批量操作条：勾选客户 → 选标签 → 批量打标签或撤标签（后端幂等，并逐条落变更流水）。
 * - 跟进记录：选中一个客户后，对该客户增删改跟进记录。
 * - 标签变更记录：customer_label 撤标即删行，所以「谁在何时打/撤了哪个标签」只能靠后端流水回溯。
 */
export default function CustomerFollowUpPage(): React.JSX.Element {
  const { t } = useTranslation()
  const customers = useCustomers({ page: 1, pageSize: 50 })
  const labelTree = useLabelTree()
  // 全租户拉取一次：统计卡用它算总数，选中客户下的列表由前端按 customerId 过滤（少两次请求、少两个轮询）。
  const allFollowUps = useCustomerFollowUps(null)
  const allChanges = useCustomerLabelChanges(null)
  const m = useCustomerFollowUpMutations()
  const batchLabel = useCustomerBatchLabel()

  const rows = useMemo(() => customers.data?.records ?? [], [customers.data])
  const labels = useMemo(() => (labelTree.data ?? []).flatMap((g) => g.labels), [labelTree.data])
  const followUps = useMemo(() => allFollowUps.data ?? [], [allFollowUps.data])
  const changes = useMemo(() => allChanges.data ?? [], [allChanges.data])

  const [sel, setSel] = useState<Set<number>>(new Set())
  const [activeId, setActiveId] = useState<number | null>(null)
  const [batchLabelId, setBatchLabelId] = useState('')

  const [editing, setEditing] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [content, setContent] = useState('')
  const [type, setType] = useState<FollowUpType>('note')
  const [remind, setRemind] = useState('')

  const [confirming, setConfirming] = useState<number | null>(null)

  const stats = useMemo(() => ({
    customers: customers.data?.total ?? rows.length,
    followUps: followUps.length,
    pending: followUps.filter((f) => f.remindAt != null && f.remindAt !== '').length,
    changes: changes.length
  }), [customers.data, rows.length, followUps, changes])

  const activeFollowUps = useMemo(
    () => (activeId == null ? [] : followUps.filter((f) => f.customerId === activeId)),
    [followUps, activeId])
  const activeChanges = useMemo(
    () => (activeId == null ? [] : changes.filter((c) => c.customerId === activeId)),
    [changes, activeId])

  const labelNameOf = (id: number): string => labels.find((l) => l.id === id)?.name ?? '#' + id
  const customerNameOf = (id: number): string =>
    rows.find((c) => c.id === id)?.nickname ?? rows.find((c) => c.id === id)?.openId ?? '#' + id

  const toggleSel = (id: number): void => {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doBatch = (action: 'add' | 'remove'): void => {
    const ids = [...sel]
    if (ids.length === 0 || batchLabelId === '') return
    batchLabel.mutate({ customerIds: ids, labelIds: [Number(batchLabelId)], action }, {
      onSuccess: () => setSel(new Set())
    })
  }

  const openCreate = (): void => {
    if (activeId == null) return
    setEditing(null)
    setCreating(true)
    setContent('')
    setType('note')
    setRemind('')
  }

  const openEdit = (id: number): void => {
    const f = followUps.find((x) => x.id === id)
    if (!f) return
    setCreating(false)
    setEditing(id)
    setContent(f.content)
    setType(f.type)
    setRemind(f.remindAt ? String(f.remindAt).slice(0, 16) : '')
  }

  const closeForm = (): void => {
    setCreating(false)
    setEditing(null)
  }

  const submit = (): void => {
    if (activeId == null) return
    // datetime-local 给到分钟（"2026-11-01T09:00"），后端 ISO_DATE_TIME 解析要秒，补 ":00"。
    const remindAt = remind === '' ? null : (remind.length === 16 ? remind + ':00' : remind)
    const body = { customerId: activeId, content: content.trim(), type, remindAt }
    if (editing != null) m.update.mutate({ id: editing, body }, { onSuccess: closeForm })
    else m.create.mutate(body, { onSuccess: closeForm })
  }

  const selectCls = 'rounded-md border border-border/60 bg-background px-2 py-1 text-sm'

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <NotebookPen className="size-4" />{t('customerfollow.title')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('customerfollow.desc')}</p>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2" data-testid="cf-stat-customers">
          <div className="text-xs text-muted-foreground">{t('customerfollow.stats.customers')}</div>
          <div className="text-lg font-semibold">{stats.customers}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2" data-testid="cf-stat-followups">
          <div className="text-xs text-muted-foreground">{t('customerfollow.stats.followUps')}</div>
          <div className="text-lg font-semibold">{stats.followUps}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2" data-testid="cf-stat-pending">
          <div className="text-xs text-muted-foreground">{t('customerfollow.stats.pending')}</div>
          <div className="text-lg font-semibold">{stats.pending}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2" data-testid="cf-stat-changes">
          <div className="text-xs text-muted-foreground">{t('customerfollow.stats.changes')}</div>
          <div className="text-lg font-semibold">{stats.changes}</div>
        </div>
      </div>

      {/* 客户列表 + 批量操作条 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('customerfollow.batch.title')}</CardTitle>
          <CardDescription className="text-xs">{t('customerfollow.batch.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <span className="text-xs text-muted-foreground" data-testid="cf-batch-count">
              {t('customerfollow.batch.selected', { count: sel.size })}
            </span>
            <select className={selectCls} value={batchLabelId}
              onChange={(e) => setBatchLabelId(e.target.value)} data-testid="cf-batch-label">
              <option value="">{t('customerfollow.batch.pickLabel')}</option>
              {labels.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={sel.size === 0 || batchLabelId === ''}
              onClick={() => doBatch('add')} data-testid="cf-batch-add">
              <Tag className="size-3.5" />{t('customerfollow.batch.add')}
            </Button>
            <Button size="sm" variant="outline" disabled={sel.size === 0 || batchLabelId === ''}
              onClick={() => doBatch('remove')} data-testid="cf-batch-remove">
              <Minus className="size-3.5" />{t('customerfollow.batch.remove')}
            </Button>
          </div>
          <div className="max-h-52 overflow-auto">
            <table className="w-full text-sm" data-testid="cf-customer-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-left font-medium">{t('customerfollow.batch.customer')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('customerfollow.batch.labels')}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-border/40 last:border-0" data-testid={`cf-row-${c.id}`}>
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggleSel(c.id)}
                        data-testid={`cf-check-${c.id}`} />
                    </td>
                    <td className="px-2 py-2">{c.nickname ?? c.openId}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground" data-testid={`cf-crow-labels-${c.id}`}>
                      {c.labels.length === 0 ? '—' : c.labels.map((l) => l.name).join('、')}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button size="sm" variant={activeId === c.id ? 'default' : 'ghost'}
                        onClick={() => setActiveId(c.id)} data-testid={`cf-select-${c.id}`}>
                        {t('customerfollow.batch.viewFollowUps')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 跟进记录 + 标签变更记录 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t('customerfollow.followUp.title')}</CardTitle>
              <Button size="sm" variant="outline" disabled={activeId == null}
                onClick={openCreate} data-testid="cf-fu-new">
                <Plus className="size-3.5" />{t('customerfollow.followUp.new')}
              </Button>
            </div>
            <CardDescription className="text-xs">
              {activeId == null ? t('customerfollow.followUp.pickCustomer') : customerNameOf(activeId)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(creating || editing != null) && (
              <div className="space-y-2 rounded-md border border-border/60 p-2">
                <Input value={content} onChange={(e) => setContent(e.target.value)}
                  placeholder={t('customerfollow.followUp.content')} data-testid="cf-fu-content" />
                <div className="flex flex-wrap gap-2">
                  <select className={selectCls} value={type}
                    onChange={(e) => setType(e.target.value as FollowUpType)} data-testid="cf-fu-type">
                    {TYPES.map((x) => <option key={x} value={x}>{t(`customerfollow.type.${x}`)}</option>)}
                  </select>
                  <Input type="datetime-local" value={remind} onChange={(e) => setRemind(e.target.value)}
                    data-testid="cf-fu-remind" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={closeForm} data-testid="cf-fu-cancel">
                    {t('customerfollow.form.cancel')}
                  </Button>
                  <Button size="sm" onClick={submit} data-testid="cf-fu-submit">
                    {t('customerfollow.form.submit')}
                  </Button>
                </div>
              </div>
            )}
            {activeFollowUps.length === 0 ? (
              <div className="text-xs text-muted-foreground" data-testid="cf-fu-hint">
                {t('customerfollow.followUp.empty')}
              </div>
            ) : (
              activeFollowUps.map((f) => (
                <div key={f.id} className="rounded-md border border-border/60 px-3 py-2" data-testid={`cf-fu-row-${f.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{t(`customerfollow.type.${f.type}`)}</Badge>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(f.id)} data-testid={`cf-fu-edit-${f.id}`}>
                        {t('customerfollow.followUp.edit')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(f.id)} data-testid={`cf-fu-del-${f.id}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 text-sm">{f.content}</div>
                  {f.remindAt && (
                    <div className="mt-1 text-xs text-muted-foreground" data-testid={`cf-fu-remindat-${f.id}`}>
                      {t('customerfollow.followUp.remindAt', { at: String(f.remindAt) })}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('customerfollow.change.title')}</CardTitle>
            <CardDescription className="text-xs">{t('customerfollow.change.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeChanges.length === 0 ? (
              <div className="text-xs text-muted-foreground" data-testid="cf-lc-hint">
                {t('customerfollow.change.empty')}
              </div>
            ) : (
              activeChanges.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                  data-testid={`cf-lc-row-${c.id}`}>
                  <Badge variant={c.action === 'add' ? 'secondary' : 'destructive'}>
                    {t(`customerfollow.changeAction.${c.action}`)}
                  </Badge>
                  <span>{labelNameOf(c.labelId)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{String(c.createdAt ?? '')}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 删除二次确认 */}
      {confirming != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="cf-confirm">
          <div className="w-[320px] rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium">{t('customerfollow.confirm.title')}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t('customerfollow.confirm.desc')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming(null)} data-testid="cf-confirm-no">
                {t('customerfollow.confirm.no')}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => {
                if (confirming != null) m.remove.mutate(confirming)
                setConfirming(null)
              }} data-testid="cf-confirm-yes">
                {t('customerfollow.confirm.yes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
