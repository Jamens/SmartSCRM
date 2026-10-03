import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { useLabelTree, type LabelGroupVO, type LabelVO } from '@/api/customers'
import {
  useCreateGroup,
  useCreateLabel,
  useDeleteGroup,
  useDeleteLabel,
  useUpdateGroup,
  useUpdateLabel
} from '@/api/labels'
import { cn } from '@/lib/utils'

interface GroupDraft {
  id?: number
  name: string
  color: string
  selectType: number
}

interface LabelDraft {
  groupId: number
  id?: number
  name: string
  color: string
}

const PALETTE = ['#2a5bd7', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#94a3b8']

export default function LabelsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { data: tree = [], isPending } = useLabelTree()
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null)
  const [labelDraft, setLabelDraft] = useState<LabelDraft | null>(null)

  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()
  const deleteGroup = useDeleteGroup()
  const createLabel = useCreateLabel()
  const updateLabel = useUpdateLabel()
  const deleteLabel = useDeleteLabel()

  const saveGroup = async (): Promise<void> => {
    if (!groupDraft || !groupDraft.name.trim()) return
    const payload = { name: groupDraft.name.trim(), color: groupDraft.color, selectType: groupDraft.selectType }
    if (groupDraft.id != null) {
      await updateGroup.mutateAsync({ id: groupDraft.id, input: payload })
    } else {
      await createGroup.mutateAsync(payload)
    }
    setGroupDraft(null)
  }

  const saveLabel = async (): Promise<void> => {
    if (!labelDraft || !labelDraft.name.trim()) return
    const payload = { name: labelDraft.name.trim(), color: labelDraft.color }
    if (labelDraft.id != null) {
      await updateLabel.mutateAsync({ id: labelDraft.id, input: payload })
    } else {
      await createLabel.mutateAsync({ groupId: labelDraft.groupId, input: payload })
    }
    setLabelDraft(null)
  }

  const removeGroup = (group: LabelGroupVO): void => {
    const extra = group.labels.length ? t('labels.deleteGroupExtra', { count: group.labels.length }) : ''
    if (!window.confirm(t('labels.confirmDeleteGroup', { name: group.name, extra }))) return
    deleteGroup.mutate(group.id)
  }

  const removeLabel = (label: LabelVO): void => {
    if (!window.confirm(t('labels.confirmDeleteLabel', { name: label.name }))) return
    deleteLabel.mutate(label.id)
  }

  const busy = createGroup.isPending || updateGroup.isPending || createLabel.isPending || updateLabel.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Tags className="size-5 text-primary" />
            {t('labels.title')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('labels.groupCount', { count: tree.length })}</p>
        </div>
        <Button
          size="sm"
          onClick={() => setGroupDraft({ name: '', color: PALETTE[tree.length % PALETTE.length], selectType: 0 })}
        >
          <Plus className="size-4" />
          {t('labels.newGroup')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('labels.loading')}</p>
        ) : tree.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('labels.empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {tree.map((group) => (
              <section key={group.id} className="rounded-xl border border-border/60 bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: group.color ?? 'var(--primary)' }} />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{group.name}</h2>
                  <Badge variant="outline" className="text-[10px]">
                    {group.selectType === 1 ? t('labels.singleSelect') : t('labels.multiSelect')}
                  </Badge>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t('labels.editGroupTitle')}
                    onClick={() => setGroupDraft({ id: group.id, name: group.name, color: group.color ?? PALETTE[0], selectType: group.selectType })}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    title={t('labels.deleteGroupTitle')}
                    onClick={() => removeGroup(group)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {group.labels.map((label) => (
                    <span
                      key={label.id}
                      className="group/label flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-white"
                      style={{ backgroundColor: label.color ?? 'var(--primary)' }}
                    >
                      {label.name}
                      <span className="opacity-70">{label.useCustomerCount}</span>
                      <button
                        className="ml-0.5 rounded-full opacity-0 transition-opacity hover:bg-black/20 group-hover/label:opacity-100"
                        title={t('labels.renameLabel')}
                        onClick={() => setLabelDraft({ groupId: group.id, id: label.id, name: label.name, color: label.color ?? PALETTE[0] })}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        className="rounded-full opacity-0 transition-opacity hover:bg-black/20 group-hover/label:opacity-100"
                        title={t('labels.deleteLabelTitle')}
                        onClick={() => removeLabel(label)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                    onClick={() => setLabelDraft({ groupId: group.id, name: '', color: PALETTE[group.labels.length % PALETTE.length] })}
                  >
                    <Plus className="size-3" />
                    {t('labels.addLabel')}
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Group dialog */}
      <Dialog open={groupDraft !== null} onOpenChange={(open) => !open && setGroupDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{groupDraft?.id != null ? t('labels.editGroup') : t('labels.newGroup')}</DialogTitle>
            <DialogDescription>{t('labels.groupDesc')}</DialogDescription>
          </DialogHeader>
          {groupDraft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('labels.nameLabel')}</Label>
                <Input
                  value={groupDraft.name}
                  onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                  placeholder={t('labels.groupNamePlaceholder')}
                />
              </div>
              <ColorField value={groupDraft.color} onChange={(color) => setGroupDraft({ ...groupDraft, color })} />
              <div className="space-y-1.5">
                <Label>{t('labels.selectTypeLabel')}</Label>
                <Select
                  value={String(groupDraft.selectType)}
                  onValueChange={(v) => setGroupDraft({ ...groupDraft, selectType: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('labels.multiSelect')}</SelectItem>
                    <SelectItem value="1">{t('labels.singleSelect')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveGroup()} disabled={!groupDraft?.name.trim() || busy}>
              {busy ? t('labels.saving') : t('labels.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Label dialog */}
      <Dialog open={labelDraft !== null} onOpenChange={(open) => !open && setLabelDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labelDraft?.id != null ? t('labels.editLabel') : t('labels.newLabel')}</DialogTitle>
            <DialogDescription>{t('labels.labelDesc')}</DialogDescription>
          </DialogHeader>
          {labelDraft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('labels.nameLabel')}</Label>
                <Input
                  value={labelDraft.name}
                  onChange={(e) => setLabelDraft({ ...labelDraft, name: e.target.value })}
                  placeholder={t('labels.labelNamePlaceholder')}
                />
              </div>
              <ColorField value={labelDraft.color} onChange={(color) => setLabelDraft({ ...labelDraft, color })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveLabel()} disabled={!labelDraft?.name.trim() || busy}>
              {busy ? t('labels.saving') : t('labels.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label>{t('labels.colorLabel')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {PALETTE.map((color) => (
          <button
            key={color}
            onClick={() => onChange(color)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full ring-2 ring-offset-1 transition',
              value === color ? 'ring-foreground' : 'ring-transparent'
            )}
            style={{ backgroundColor: color }}
          >
            {value === color && <Check className="size-3.5 text-white" />}
          </button>
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-9 cursor-pointer rounded border border-border bg-transparent"
          title={t('labels.customColorTitle')}
        />
      </div>
    </div>
  )
}
