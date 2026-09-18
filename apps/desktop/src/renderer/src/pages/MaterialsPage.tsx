import { useRef, useState } from 'react'
import {
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Music,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
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
  type MaterialType,
  type MaterialVO
} from '@/api/materials'

const ALL = 'all'
const TYPES: MaterialType[] = [1, 2, 3, 4]
const MAX_INLINE_BYTES = 400 * 1024 // store small images inline as data URIs

interface MaterialDraft {
  id?: number
  name: string
  type: MaterialType
  url: string
  groupId: number | null
  remark: string
}

function typeIcon(type: MaterialType) {
  if (type === 1) return ImageIcon
  if (type === 2) return Film
  if (type === 3) return Music
  return FileText
}

export default function MaterialsPage(): React.JSX.Element {
  const { data: groups = [] } = useMaterialGroups()
  const [groupId, setGroupId] = useState<string>(ALL)
  const [type, setType] = useState<string>(ALL)
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState<MaterialDraft | null>(null)
  const [groupDraft, setGroupDraft] = useState<{ id?: number; name: string } | null>(null)

  const materials = useMaterials({
    groupId: groupId === ALL ? null : Number(groupId),
    type: type === ALL ? null : (Number(type) as MaterialType),
    keyword: keyword.trim() || undefined
  })

  const createMaterial = useCreateMaterial()
  const updateMaterial = useUpdateMaterial()
  const removeMaterial = useDeleteMaterial()
  const createGroup = useCreateMaterialGroup()
  const updateGroup = useUpdateMaterialGroup()
  const removeGroup = useDeleteMaterialGroup()

  const filteredGroupId = groupId === ALL ? null : Number(groupId)

  const openCreate = (): void =>
    setDraft({ name: '', type: 1, url: '', groupId: filteredGroupId, remark: '' })

  const openEdit = (material: MaterialVO): void =>
    setDraft({
      id: material.id,
      name: material.name,
      type: material.type,
      url: material.url,
      groupId: material.groupId,
      remark: material.remark ?? ''
    })

  const saveMaterial = async (): Promise<void> => {
    if (!draft || !draft.name.trim() || !draft.url.trim()) return
    const input = {
      name: draft.name.trim(),
      type: draft.type,
      url: draft.url.trim(),
      groupId: draft.groupId,
      remark: draft.remark.trim() || null
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
    const warning = group.materialCount > 0 ? `（其下 ${group.materialCount} 个素材将变为未分组）` : ''
    if (!window.confirm(`确认删除分组「${group.name}」${warning}？`)) return
    removeGroup.mutate(group.id)
  }

  const records = materials.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <FolderOpen className="size-5 text-primary" />
            素材库
          </h1>
          <p className="text-xs text-muted-foreground">可复用的图片 / 视频 / 文件素材，供快捷回复与群发引用</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setGroupDraft({ name: '' })}>
            <Plus className="size-4" />
            新建分组
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新建素材
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-3">
        <Input
          className="w-56 max-w-full"
          placeholder="搜索素材名称 / 备注"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={groupId === ALL} onClick={() => setGroupId(ALL)}>
            全部分组
          </FilterChip>
          {groups.map((group) => (
            <FilterChip key={group.id} active={groupId === String(group.id)} onClick={() => setGroupId(String(group.id))}>
              {group.name}
              <span className="ml-1 opacity-70">{group.materialCount}</span>
            </FilterChip>
          ))}
          {filteredGroupId != null && (
            <>
              <button
                className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                title="重命名分组"
                onClick={() =>
                  setGroupDraft({
                    id: filteredGroupId,
                    name: groups.find((g) => g.id === filteredGroupId)?.name ?? ''
                  })
                }
              >
                <Pencil className="size-3" />
                重命名
              </button>
              <button
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                title="删除分组"
                onClick={() => {
                  const group = groups.find((g) => g.id === filteredGroupId)
                  if (!group) return
                  deleteGroup(group)
                  setGroupId(ALL)
                }}
              >
                <Trash2 className="size-3" />
                删除
              </button>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <FilterChip active={type === ALL} onClick={() => setType(ALL)}>
            全部类型
          </FilterChip>
          {TYPES.map((t) => (
            <FilterChip key={t} active={type === String(t)} onClick={() => setType(String(t))}>
              {MATERIAL_TYPE_LABELS[t]}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {materials.isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载素材中…</p>
        ) : records.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">没有符合条件的素材。</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {records.map((material) => (
              <MaterialCard
                key={material.id}
                material={material}
                groupName={groups.find((g) => g.id === material.groupId)?.name}
                onEdit={() => openEdit(material)}
                onDelete={() => {
                  if (window.confirm(`确认删除素材「${material.name}」？`)) removeMaterial.mutate(material.id)
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
            <DialogTitle>{draft?.id != null ? '编辑素材' : '新建素材'}</DialogTitle>
            <DialogDescription>小图片会以本地 data URI 直接保存，完全离线可预览。</DialogDescription>
          </DialogHeader>
          {draft && (
            <MaterialForm draft={draft} groups={groups} onChange={setDraft} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              onClick={() => void saveMaterial()}
              disabled={!draft?.name.trim() || !draft?.url.trim() || createMaterial.isPending || updateMaterial.isPending}
            >
              {createMaterial.isPending || updateMaterial.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group dialog */}
      <Dialog open={groupDraft !== null} onOpenChange={(open) => !open && setGroupDraft(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{groupDraft?.id != null ? '重命名分组' : '新建分组'}</DialogTitle>
          </DialogHeader>
          {groupDraft && (
            <div className="space-y-1.5">
              <Label>分组名称</Label>
              <Input
                value={groupDraft.name}
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                placeholder="例如：产品图"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDraft(null)}>
              取消
            </Button>
            <Button onClick={() => void saveGroup()} disabled={!groupDraft?.name.trim() || createGroup.isPending || updateGroup.isPending}>
              保存
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
  const Icon = typeIcon(material.type)
  const isImage = material.type === 1 && material.url.startsWith('data:')
  return (
    <div className="group overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted/40">
        {isImage ? (
          <img src={material.url} alt={material.name} className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {material.type === 1 ? (
              <img src={material.url} alt={material.name} className="size-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <Icon className="size-10" />
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{material.name}</p>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {MATERIAL_TYPE_LABELS[material.type]}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{groupName ?? '未分组'}</p>
        <div className="mt-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex gap-1">
            <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="复制链接" onClick={() => void navigator.clipboard.writeText(material.url)}>
              <Link2 className="size-3.5" />
            </button>
            <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </button>
          </div>
          <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" title="删除" onClick={onDelete}>
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
      reader.onload = () => onChange({ ...draft, type, name, url: String(reader.result), remark: draft.remark })
      reader.readAsDataURL(file)
      setNotice('')
    } else if (type === 1) {
      onChange({ ...draft, type, name })
      setNotice('图片较大，请改用素材 URL（本地暂存限制 400KB）。')
    } else {
      onChange({ ...draft, type, name })
      setNotice('非图片素材请填写素材 URL。')
    }
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>名称</Label>
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="素材名称" />
        </div>
        <div className="space-y-1.5">
          <Label>类型</Label>
          <Select value={String(draft.type)} onValueChange={(v) => onChange({ ...draft, type: Number(v) as MaterialType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {MATERIAL_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>分组</Label>
          {draft.groupId != null && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...draft, groupId: null })}>
              取消分组
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
            <SelectItem value="none">未分组</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>素材内容（图片 URL / data URI）</Label>
        <div className="flex items-start gap-2">
          {draft.type === 1 && draft.url.startsWith('data:') && (
            <img src={draft.url} alt="预览" className="size-16 shrink-0 rounded-md border border-border object-cover" />
          )}
          <textarea
            className="h-16 min-w-0 flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft.url.startsWith('data:') ? `${draft.url.slice(0, 40)}…（内嵌图片）` : draft.url}
            onChange={(e) => onChange({ ...draft, url: e.target.value })}
            placeholder="粘贴 https 图片/文件地址，或点击下方选择本地图片"
          />
        </div>
        {draft.url.startsWith('data:') && (
          <p className="text-[11px] text-muted-foreground">已内嵌本地图片，可继续选择其它图片或清空后粘贴 URL。</p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={pickImage} disabled={draft.type !== 1}>
            选择本地图片
          </Button>
          {draft.url.startsWith('data:') && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...draft, url: '' })}>
              清空图片
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
        {notice && <p className="text-[11px] text-amber-600">{notice}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>备注（可选）</Label>
        <Input value={draft.remark} onChange={(e) => onChange({ ...draft, remark: e.target.value })} placeholder="用途说明" />
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}
