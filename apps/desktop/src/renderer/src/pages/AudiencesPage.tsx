import { useState } from 'react'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, Eye, Pencil, Plus, Target, Trash2, Users } from 'lucide-react'
import { PLATFORMS, platformOf } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useLabelTree, type LabelVO } from '@/api/customers'
import {
  useAudienceCustomers,
  useAudiences,
  useCreateAudience,
  useDeleteAudience,
  useUpdateAudience,
  type AudienceVO
} from '@/api/audiences'
import { cn } from '@/lib/utils'

const ALL = 'all'

interface AudienceDraft {
  id?: number
  name: string
  platformType: string
  keyword: string
  tagIds: number[]
}

function toInput(draft: AudienceDraft) {
  return {
    name: draft.name.trim(),
    platformType: draft.platformType === ALL ? null : Number(draft.platformType),
    keyword: draft.keyword.trim() || null,
    tagIds: draft.tagIds
  }
}

export default function AudiencesPage(): React.JSX.Element {
  const { data: audiences = [], isPending } = useAudiences()
  const { data: tree = [] } = useLabelTree()
  const [draft, setDraft] = useState<AudienceDraft | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)

  const createAudience = useCreateAudience()
  const updateAudience = useUpdateAudience()
  const removeAudience = useDeleteAudience()

  const labelById = new Map<number, LabelVO>()
  tree.forEach((group) => group.labels.forEach((label) => labelById.set(label.id, label)))

  const openCreate = (): void => setDraft({ name: '', platformType: ALL, keyword: '', tagIds: [] })
  const openEdit = (audience: AudienceVO): void =>
    setDraft({
      id: audience.id,
      name: audience.name,
      platformType: audience.platformType != null ? String(audience.platformType) : ALL,
      keyword: audience.keyword ?? '',
      tagIds: [...audience.tagIds]
    })

  const save = async (): Promise<void> => {
    if (!draft || !draft.name.trim()) return
    if (draft.id != null) {
      await updateAudience.mutateAsync({ id: draft.id, input: toInput(draft) })
    } else {
      await createAudience.mutateAsync(toInput(draft))
    }
    setDraft(null)
  }

  const remove = (audience: AudienceVO): void => {
    if (!window.confirm(`确认删除人群包「${audience.name}」？`)) return
    removeAudience.mutate(audience.id)
  }

  const toggleTag = (id: number): void => {
    setDraft((prev) =>
      prev ? { ...prev, tagIds: prev.tagIds.includes(id) ? prev.tagIds.filter((x) => x !== id) : [...prev.tagIds, id] } : prev
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Target className="size-5 text-primary" />
            人群包
          </h1>
          <p className="text-xs text-muted-foreground">按标签 / 平台 / 关键词组合保存的客户分群</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          新建人群包
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载人群包中…</p>
        ) : audiences.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">还没有人群包，点击右上角新建。</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {audiences.map((audience) => (
              <section key={audience.id} className="flex flex-col rounded-xl border border-border/60 bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{audience.name}</h2>
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <Users className="size-3" />
                    {audience.customerCount}
                  </Badge>
                </div>
                <div className="mb-3 space-y-1 text-xs text-muted-foreground">
                  <p>平台：{audience.platformType != null ? platformOf(audience.platformType)?.label : '全部'}</p>
                  <p className="truncate">关键词：{audience.keyword || '—'}</p>
                  <div className="flex flex-wrap gap-1">
                    {audience.tagIds.length === 0 && <span>标签：—</span>}
                    {audience.tagIds.map((id) => {
                      const label = labelById.get(id)
                      return (
                        <span
                          key={id}
                          className="rounded-full px-2 py-0.5 text-[11px] text-white"
                          style={{ backgroundColor: label?.color ?? 'var(--primary)' }}
                        >
                          {label?.name ?? `#${id}`}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2">
                  <span className="text-[11px] text-muted-foreground">{dayjs(audience.createdAt).format('YYYY-MM-DD')}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPreviewId(audience.id)}>
                      <Eye className="size-4" />
                      查看
                    </Button>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" onClick={() => openEdit(audience)}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title="删除" onClick={() => remove(audience)}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id != null ? '编辑人群包' : '新建人群包'}</DialogTitle>
            <DialogDescription>条件为「同时满足」：所选标签全部命中，再叠加平台与关键词。</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：高价值成交客户" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>平台</Label>
                  <Select value={draft.platformType} onValueChange={(v) => setDraft({ ...draft, platformType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部平台</SelectItem>
                      {Object.values(PLATFORMS).map((p) => (
                        <SelectItem key={p.type} value={String(p.type)}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>关键词</Label>
                  <Input value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} placeholder="匹配昵称/手机/邮箱" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>标签（需全部命中）</Label>
                {tree.length === 0 && <p className="text-xs text-muted-foreground">还没有标签，请先到「标签」创建。</p>}
                <div className="space-y-2">
                  {tree.map((group) => (
                    <div key={group.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{group.name}</span>
                      {group.labels.map((label) => {
                        const active = draft.tagIds.includes(label.id)
                        return (
                          <button
                            key={label.id}
                            onClick={() => toggleTag(label.id)}
                            className={cn(
                              'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                              active ? 'text-white' : 'border-border text-muted-foreground hover:bg-muted'
                            )}
                            style={active ? { backgroundColor: label.color ?? 'var(--primary)', borderColor: 'transparent' } : undefined}
                          >
                            {label.name}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={!draft?.name.trim() || createAudience.isPending || updateAudience.isPending}>
              {createAudience.isPending || updateAudience.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewId != null && <AudiencePreviewDialog audienceId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  )
}

function AudiencePreviewDialog({
  audienceId,
  onClose
}: {
  audienceId: number
  onClose: () => void
}): React.JSX.Element {
  const [page, setPage] = useState(1)
  const pageSize = 8
  const { data, isPending } = useAudienceCustomers(audienceId, page, pageSize)
  const records = data?.records ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>人群包客户</DialogTitle>
          <DialogDescription>共 {total} 位客户命中该人群包条件。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1 overflow-auto">
          {isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
          ) : records.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无命中客户。</p>
          ) : (
            records.map((customer) => {
              const meta = platformOf(customer.platformType)
              return (
                <div key={customer.id} className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-2">
                  <Avatar className="size-8">
                    <AvatarImage src={customer.avatar ?? undefined} />
                    <AvatarFallback className="text-xs" style={{ backgroundColor: meta?.color, color: '#fff' }}>
                      {(customer.nickname ?? customer.openId).trim().slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{customer.nickname ?? '未命名客户'}</p>
                    <p className="truncate text-xs text-muted-foreground">{meta?.label} · {customer.openId}</p>
                  </div>
                  <div className="flex max-w-[10rem] flex-wrap justify-end gap-1">
                    {customer.labels.slice(0, 2).map((label) => (
                      <Badge key={label.id} variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {label.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            第 {page} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-4" />
              上一页
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              下一页
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
