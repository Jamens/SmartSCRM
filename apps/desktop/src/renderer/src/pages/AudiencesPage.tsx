import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

function toInput(draft: AudienceDraft): { name: string; platformType: number | null; keyword: string | null; tagIds: number[]; } {
  return {
    name: draft.name.trim(),
    platformType: draft.platformType === ALL ? null : Number(draft.platformType),
    keyword: draft.keyword.trim() || null,
    tagIds: draft.tagIds
  }
}

export default function AudiencesPage(): React.JSX.Element {
  const { t } = useTranslation()
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
    if (!window.confirm(t('audiences.deleteConfirm', { name: audience.name }))) return
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
            {t('audiences.title')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('audiences.subtitle')}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          {t('audiences.newAudience')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('audiences.loading')}</p>
        ) : audiences.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('audiences.empty')}</p>
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
                  <p>{t('audiences.platformPrefix')}{audience.platformType != null ? platformOf(audience.platformType)?.label : t('audiences.all')}</p>
                  <p className="truncate">{t('audiences.keywordPrefix')}{audience.keyword || t('audiences.none')}</p>
                  <div className="flex flex-wrap gap-1">
                    {audience.tagIds.length === 0 && <span>{t('audiences.tagPrefix')}{t('audiences.none')}</span>}
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
                      {t('audiences.view')}
                    </Button>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('audiences.edit')} onClick={() => openEdit(audience)}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title={t('audiences.delete')} onClick={() => remove(audience)}>
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
            <DialogTitle>{draft?.id != null ? t('audiences.editAudience') : t('audiences.newAudience')}</DialogTitle>
            <DialogDescription>{t('audiences.dialogDesc')}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('audiences.name')}</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('audiences.namePlaceholder')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('audiences.platform')}</Label>
                  <Select value={draft.platformType} onValueChange={(v) => setDraft({ ...draft, platformType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{t('audiences.allPlatforms')}</SelectItem>
                      {Object.values(PLATFORMS).map((p) => (
                        <SelectItem key={p.type} value={String(p.type)}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('audiences.keyword')}</Label>
                  <Input value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} placeholder={t('audiences.keywordPlaceholder')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('audiences.tagField')}</Label>
                {tree.length === 0 && <p className="text-xs text-muted-foreground">{t('audiences.noLabelsHint')}</p>}
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
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={!draft?.name.trim() || createAudience.isPending || updateAudience.isPending}>
              {createAudience.isPending || updateAudience.isPending ? t('labels.saving') : t('labels.save')}
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
  const { t } = useTranslation()
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
          <DialogTitle>{t('audiences.previewTitle')}</DialogTitle>
          <DialogDescription>{t('audiences.previewDesc', { total })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1 overflow-auto">
          {isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('audiences.loading')}</p>
          ) : records.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('audiences.previewEmpty')}</p>
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
                    <p className="truncate text-sm font-medium">{customer.nickname ?? t('audiences.unnamedCustomer')}</p>
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
            {t('audiences.pageInfo', { page, pageCount })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-4" />
              {t('audiences.prevPage')}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              {t('audiences.nextPage')}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
