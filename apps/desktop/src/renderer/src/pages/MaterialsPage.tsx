import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Film, FolderOpen, Link2, Music, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  MATERIAL_SCOPE_LABELS,
  MATERIAL_TYPE_LABELS,
  useCreateMaterial,
  useCreateMaterialGroup,
  useDeleteMaterial,
  useDeleteMaterialGroup,
  useMaterialGroups,
  useMaterials,
  useUpdateMaterial,
  useUpdateMaterialGroup,
  type MaterialGroupVO,
  type MaterialOwnerScope,
  type MaterialType,
  type MaterialVO
} from '@/api/materials'

const ALL = 'all'
const TYPES: MaterialType[] = [1, 2, 3, 4]
/**
 * 筛选条只给「全部 / 公共 / 我的」三档：**没有「联系人」**——contact 档素材必须带客户 id
 * 才查得到，而管理页没有客户上下文，放一个永远返回空的筛选项只会让人以为功能坏了。
 * 联系人素材在创建表单里选，展示在该客户的会话里。
 */
const SCOPE_FILTERS: MaterialOwnerScope[] = ['public', 'personal']
const MAX_INLINE_BYTES = 400 * 1024 // store small images inline as data URIs

interface MaterialDraft {
  id?: number
  name: string
  type: MaterialType
  url: string
  groupId: number | null
  remark: string
  ownerScope: MaterialOwnerScope
  /** 仅 contact 档使用：客户 id。personal 档由后端取调用者自己，前端不存。 */
  ownerKey: string
}

export default function MaterialsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { data: groups = [] } = useMaterialGroups()
  const [groupId, setGroupId] = useState<string>(ALL)
  const [type, setType] = useState<string>(ALL)
  const [scope, setScope] = useState<string>(ALL)
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState<MaterialDraft | null>(null)
  const [groupDraft, setGroupDraft] = useState<{ id?: number; name: string } | null>(null)

  const materials = useMaterials({
    groupId: groupId === ALL ? null : Number(groupId),
    type: type === ALL ? null : (Number(type) as MaterialType),
    keyword: keyword.trim() || undefined,
    ownerScope: scope === ALL ? null : (scope as MaterialOwnerScope)
  })

  const createMaterial = useCreateMaterial()
  const updateMaterial = useUpdateMaterial()
  const removeMaterial = useDeleteMaterial()
  const createGroup = useCreateMaterialGroup()
  const updateGroup = useUpdateMaterialGroup()
  const removeGroup = useDeleteMaterialGroup()

  const filteredGroupId = groupId === ALL ? null : Number(groupId)

  const openCreate = (): void =>
    setDraft({
      name: '',
      type: 1,
      url: '',
      groupId: filteredGroupId,
      remark: '',
      ownerScope: 'public',
      ownerKey: ''
    })

  const openEdit = (material: MaterialVO): void =>
    setDraft({
      id: material.id,
      name: material.name,
      type: material.type,
      url: material.url,
      groupId: material.groupId,
      remark: material.remark ?? '',
      ownerScope: material.ownerScope,
      ownerKey: material.ownerScope === 'contact' ? (material.ownerKey ?? '') : ''
    })

  const saveMaterial = async (): Promise<void> => {
    if (!draft || !draft.name.trim() || !draft.url.trim()) return
    // contact 档缺客户 id 后端会 40000，这里先挡住，别让人填完表单才收到一句报错。
    if (draft.ownerScope === 'contact' && !draft.ownerKey.trim()) return
    const input = {
      name: draft.name.trim(),
      type: draft.type,
      url: draft.url.trim(),
      groupId: draft.groupId,
      remark: draft.remark.trim() || null,
      ownerScope: draft.ownerScope,
      // personal 档后端强制盖成调用者自己，前端不送；contact 档送客户 id。
      ownerKey: draft.ownerScope === 'contact' ? draft.ownerKey.trim() : null
    }
    if (draft.id != null) {
      await updateMaterial.mutateAsync({ id: draft.id, input })
    } else {
      await createMaterial.mutateAsync(input)
    }
    setDraft(null)
  }

  const saveGroup = async (): Promise<void> => {
    if (!groupDraft || !groupDraft.name.trim()) return
    if (groupDraft.id != null) {
      await updateGroup.mutateAsync({ id: groupDraft.id, input: { name: groupDraft.name.trim() } })
    } else {
      await createGroup.mutateAsync({ name: groupDraft.name.trim() })
    }
    setGroupDraft(null)
  }

  const deleteGroup = (group: MaterialGroupVO): void => {
    const warning =
      group.materialCount > 0
        ? t('materials.deleteGroupWarning', { count: group.materialCount })
        : ''
    if (!window.confirm(t('materials.deleteGroupConfirm', { name: group.name, warning }))) return
    removeGroup.mutate(group.id)
  }

  const records = materials.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <FolderOpen className="size-5 text-primary" />
            {t('materials.title')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('materials.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setGroupDraft({ name: '' })}>
            <Plus className="size-4" />
            {t('materials.newGroup')}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            {t('materials.newMaterial')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-3">
        <Input
          className="w-56 max-w-full"
          placeholder={t('materials.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={groupId === ALL} onClick={() => setGroupId(ALL)}>
            {t('materials.allGroups')}
          </FilterChip>
          {groups.map((group) => (
            <FilterChip
              key={group.id}
              active={groupId === String(group.id)}
              onClick={() => setGroupId(String(group.id))}
            >
              {group.name}
              <span className="ml-1 opacity-70">{group.materialCount}</span>
            </FilterChip>
          ))}
          {filteredGroupId != null && (
            <>
              <button
                className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t('materials.renameGroup')}
                onClick={() =>
                  setGroupDraft({
                    id: filteredGroupId,
                    name: groups.find((g) => g.id === filteredGroupId)?.name ?? ''
                  })
                }
              >
                <Pencil className="size-3" />
                {t('materials.rename')}
              </button>
              <button
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                title={t('materials.deleteGroup')}
                onClick={() => {
                  const group = groups.find((g) => g.id === filteredGroupId)
                  if (!group) return
                  deleteGroup(group)
                  setGroupId(ALL)
                }}
              >
                <Trash2 className="size-3" />
                {t('materials.delete')}
              </button>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <FilterChip active={type === ALL} onClick={() => setType(ALL)}>
            {t('materials.allTypes')}
          </FilterChip>
          {TYPES.map((tt) => (
            <FilterChip key={tt} active={type === String(tt)} onClick={() => setType(String(tt))}>
              {t(MATERIAL_TYPE_LABELS[tt])}
            </FilterChip>
          ))}
        </div>
        <div className="flex w-full items-center gap-1.5 border-t border-border/40 pt-2">
          <span className="text-xs text-muted-foreground">{t('materials.scope.label')}</span>
          <FilterChip active={scope === ALL} onClick={() => setScope(ALL)}>
            {t('materials.scope.all')}
          </FilterChip>
          {SCOPE_FILTERS.map((s) => (
            <FilterChip key={s} active={scope === s} onClick={() => setScope(s)}>
              {t(MATERIAL_SCOPE_LABELS[s])}
            </FilterChip>
          ))}
          <span className="text-[11px] text-muted-foreground">{t('materials.scope.hint')}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {materials.isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t('materials.loading')}
          </p>
        ) : records.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('materials.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {records.map((material) => (
              <MaterialCard
                key={material.id}
                material={material}
                groupName={groups.find((g) => g.id === material.groupId)?.name}
                onEdit={() => openEdit(material)}
                onDelete={() => {
                  if (window.confirm(t('materials.deleteMaterialConfirm', { name: material.name })))
                    removeMaterial.mutate(material.id)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Material dialog */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.id != null ? t('materials.editMaterial') : t('materials.newMaterial')}
            </DialogTitle>
            <DialogDescription>{t('materials.dialogDesc')}</DialogDescription>
          </DialogHeader>
          {draft && <MaterialForm draft={draft} groups={groups} onChange={setDraft} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void saveMaterial()}
              disabled={
                !draft?.name.trim() ||
                !draft?.url.trim() ||
                // 与 saveMaterial 里的守卫同一条规则：按钮先置灰，比填完表单收到一句 40000 好。
                (draft?.ownerScope === 'contact' && !draft.ownerKey.trim()) ||
                createMaterial.isPending ||
                updateMaterial.isPending
              }
            >
              {createMaterial.isPending || updateMaterial.isPending
                ? t('labels.saving')
                : t('labels.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group dialog */}
      <Dialog open={groupDraft !== null} onOpenChange={(open) => !open && setGroupDraft(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {groupDraft?.id != null ? t('materials.renameGroup') : t('materials.newGroup')}
            </DialogTitle>
          </DialogHeader>
          {groupDraft && (
            <div className="space-y-1.5">
              <Label>{t('materials.groupNameLabel')}</Label>
              <Input
                value={groupDraft.name}
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                placeholder={t('materials.groupNamePlaceholder')}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void saveGroup()}
              disabled={!groupDraft?.name.trim() || createGroup.isPending || updateGroup.isPending}
            >
              {t('labels.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MaterialCard({
  material,
  groupName,
  onEdit,
  onDelete
}: {
  material: MaterialVO
  groupName?: string
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isImage = material.type === 1 && material.url.startsWith('data:')
  return (
    <div className="group overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted/40">
        {isImage ? (
          <img src={material.url} alt={material.name} className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {material.type === 1 ? (
              <img
                src={material.url}
                alt={material.name}
                className="size-full object-cover"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            ) : // 直接引用已导入的稳定 lucide 组件，避免在渲染期把 typeIcon 返回的组件赋给变量再当 JSX 用
            // （react-hooks/static-components：渲染期创建组件会让其 state 每帧重置）。
            material.type === 2 ? (
              <Film className="size-10" />
            ) : material.type === 3 ? (
              <Music className="size-10" />
            ) : (
              <FileText className="size-10" />
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {material.name}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {/* public 是默认态也是绝大多数，挂徽标等于整列同色，是噪声；
                另两档才标——"这条只有我能用 / 这条绑着某个客户"才是要看的信息。 */}
            {material.ownerScope === 'personal' && (
              <Badge
                variant="outline"
                className="shrink-0 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300"
              >
                {t('materials.scope.personal')}
              </Badge>
            )}
            {material.ownerScope === 'contact' && (
              <Badge
                variant="outline"
                className="shrink-0 bg-violet-500/15 text-[10px] text-violet-700 dark:text-violet-300"
                title={t('materials.scope.contactTitle', { id: material.ownerKey ?? '?' })}
              >
                {t('materials.scope.contact')}
              </Badge>
            )}
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {t(MATERIAL_TYPE_LABELS[material.type])}
            </Badge>
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {groupName ?? t('materials.ungrouped')}
        </p>
        <div className="mt-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex gap-1">
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t('materials.copyLink')}
              onClick={() => void navigator.clipboard.writeText(material.url)}
            >
              <Link2 className="size-3.5" />
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t('materials.edit')}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </button>
          </div>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            title={t('materials.delete')}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function MaterialForm({
  draft,
  groups,
  onChange
}: {
  draft: MaterialDraft
  groups: MaterialGroupVO[]
  onChange: (next: MaterialDraft) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')

  const pickImage = (): void => {
    fileRef.current?.click()
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const type: MaterialType = file.type.startsWith('video')
      ? 2
      : file.type.startsWith('audio')
        ? 3
        : file.type.startsWith('image')
          ? 1
          : 4
    const name = draft.name || file.name.replace(/\.[^.]+$/, '')
    if (type === 1 && file.size <= MAX_INLINE_BYTES) {
      const reader = new FileReader()
      reader.onload = () =>
        onChange({ ...draft, type, name, url: String(reader.result), remark: draft.remark })
      reader.readAsDataURL(file)
      setNotice('')
    } else if (type === 1) {
      onChange({ ...draft, type, name })
      setNotice(t('materials.noticeLargeImage'))
    } else {
      onChange({ ...draft, type, name })
      setNotice(t('materials.noticeNonImage'))
    }
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('materials.name')}</Label>
          <Input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t('materials.namePlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t('materials.typeLabel')}</Label>
          <Select
            value={String(draft.type)}
            onValueChange={(v) => onChange({ ...draft, type: Number(v) as MaterialType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((tt) => (
                <SelectItem key={tt} value={String(tt)}>
                  {t(MATERIAL_TYPE_LABELS[tt])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t('materials.group')}</Label>
          {draft.groupId != null && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ ...draft, groupId: null })}
            >
              {t('materials.ungroup')}
            </button>
          )}
        </div>
        <Select
          value={draft.groupId != null ? String(draft.groupId) : 'none'}
          onValueChange={(v) => onChange({ ...draft, groupId: v === 'none' ? null : Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('materials.ungrouped')}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t('materials.scope.label')}</Label>
        <Select
          value={draft.ownerScope}
          onValueChange={(v) =>
            onChange({ ...draft, ownerScope: v as MaterialOwnerScope, ownerKey: '' })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">{t('materials.scope.public')}</SelectItem>
            <SelectItem value="personal">{t('materials.scope.personal')}</SelectItem>
            <SelectItem value="contact">{t('materials.scope.contact')}</SelectItem>
          </SelectContent>
        </Select>
        {/* 只有 contact 档要客户 id；personal 档后端自动取当前坐席，让人填反而会误导
            （填了也不生效，还会让人以为能指定给别人）。 */}
        {draft.ownerScope === 'contact' && (
          <div className="space-y-1.5 pt-1">
            <Input
              value={draft.ownerKey}
              onChange={(e) => onChange({ ...draft, ownerKey: e.target.value })}
              placeholder={t('materials.scope.customerIdPlaceholder')}
              inputMode="numeric"
            />
            <p className="text-[11px] text-muted-foreground">{t('materials.scope.hint')}</p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>{t('materials.contentLabel')}</Label>
        <div className="flex items-start gap-2">
          {draft.type === 1 && draft.url.startsWith('data:') && (
            <img
              src={draft.url}
              alt={t('materials.preview')}
              className="size-16 shrink-0 rounded-md border border-border object-cover"
            />
          )}
          <textarea
            className="h-16 min-w-0 flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={
              draft.url.startsWith('data:')
                ? `${draft.url.slice(0, 40)}…${t('materials.inlinePreview')}`
                : draft.url
            }
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            placeholder={t('materials.urlPlaceholder')}
          />
        </div>
        {draft.url.startsWith('data:') && (
          <p className="text-[11px] text-muted-foreground">{t('materials.inlineNote')}</p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={pickImage} disabled={draft.type !== 1}>
            {t('materials.pickLocalImage')}
          </Button>
          {draft.url.startsWith('data:') && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...draft, url: '' })}>
              {t('materials.clearImage')}
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
        {notice && <p className="text-[11px] text-amber-600">{notice}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>{t('materials.remarkLabel')}</Label>
        <Input
          value={draft.remark}
          onChange={(e) => onChange({ ...draft, remark: e.target.value })}
          placeholder={t('materials.remarkPlaceholder')}
        />
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}
