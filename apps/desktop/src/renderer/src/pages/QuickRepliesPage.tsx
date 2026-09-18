import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  CreditCard,
  Image as ImageIcon,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2,
  Type
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
import { useMaterials, type MaterialVO } from '@/api/materials'
import {
  useCreateQuickReply,
  useCreateQuickReplyGroup,
  useDeleteQuickReply,
  useDeleteQuickReplyGroup,
  useQuickReplyGroups,
  useQuickReplies,
  useRecordQuickReplyUse,
  useUpdateQuickReply,
  useUpdateQuickReplyGroup,
  type QuickReplyGroupVO,
  type QuickReplyItemInput,
  type QuickReplyItemVO,
  type QuickReplyVO,
  type ReplyItemType
} from '@/api/quickReplies'

const ALL = 'all'
const ITEM_TYPES: ReplyItemType[] = [1, 2, 3]
const ITEM_TYPE_LABELS: Record<ReplyItemType, string> = { 1: '文字', 2: '图片', 3: '名片' }

interface ItemDraft {
  type: ReplyItemType
  content: string
  materialId: number | null
  mediaUrl: string
  cardName: string
  cardPhone: string
}

interface ReplyDraft {
  id?: number
  title: string
  shortcut: string
  groupId: number | null
  items: ItemDraft[]
}

function toItemDraft(item: QuickReplyItemVO): ItemDraft {
  return {
    type: item.type,
    content: item.content ?? '',
    materialId: item.materialId,
    mediaUrl: item.mediaUrl ?? '',
    cardName: item.cardName ?? '',
    cardPhone: item.cardPhone ?? ''
  }
}

function emptyItem(type: ReplyItemType): ItemDraft {
  return { type, content: '', materialId: null, mediaUrl: '', cardName: '', cardPhone: '' }
}

function toInput(draft: ItemDraft): QuickReplyItemInput {
  const fromLibrary = draft.type === 2 && draft.materialId != null
  return {
    type: draft.type,
    content: draft.type === 1 ? draft.content.trim() || null : null,
    materialId: draft.materialId,
    // The server snapshots the URL from the material itself; no need to re-upload a data URI.
    mediaUrl: fromLibrary ? null : draft.mediaUrl || null,
    cardName: draft.type === 3 ? draft.cardName.trim() || null : null,
    cardPhone: draft.type === 3 ? draft.cardPhone.trim() || null : null
  }
}

/** Flatten a reply into the text actually sent to the customer. */
function toPlainText(reply: QuickReplyVO): string {
  return reply.items
    .map((item) => {
      if (item.type === 1) return item.content ?? ''
      if (item.type === 2) return item.mediaUrl ?? ''
      const phone = item.cardPhone ? ` ${item.cardPhone}` : ''
      return `${item.cardName ?? '名片'}${phone}`
    })
    .filter((line) => line.length > 0)
    .join('\n')
}

function itemValid(draft: ItemDraft): boolean {
  if (draft.type === 1) return draft.content.trim().length > 0
  if (draft.type === 2) return draft.materialId != null || draft.mediaUrl.trim().length > 0
  return draft.cardName.trim().length > 0
}

export default function QuickRepliesPage(): React.JSX.Element {
  const { data: groups = [] } = useQuickReplyGroups()
  const [groupId, setGroupId] = useState<string>(ALL)
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState<ReplyDraft | null>(null)
  const [groupDraft, setGroupDraft] = useState<{ id?: number; name: string } | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const replies = useQuickReplies(
    groupId === ALL ? null : Number(groupId),
    keyword.trim() || undefined
  )

  const createReply = useCreateQuickReply()
  const updateReply = useUpdateQuickReply()
  const removeReply = useDeleteQuickReply()
  const recordUse = useRecordQuickReplyUse()
  const createGroup = useCreateQuickReplyGroup()
  const updateGroup = useUpdateQuickReplyGroup()
  const removeGroup = useDeleteQuickReplyGroup()

  const filteredGroupId = groupId === ALL ? null : Number(groupId)

  const openCreate = (): void =>
    setDraft({
      title: '',
      shortcut: '',
      groupId: filteredGroupId ?? groups[0]?.id ?? null,
      items: [emptyItem(1)]
    })

  const openEdit = (reply: QuickReplyVO): void =>
    setDraft({
      id: reply.id,
      title: reply.title,
      shortcut: reply.shortcut ?? '',
      groupId: reply.groupId,
      items: reply.items.length > 0 ? reply.items.map(toItemDraft) : [emptyItem(1)]
    })

  const saveReply = async (): Promise<void> => {
    if (!draft || !draft.title.trim() || draft.groupId == null) return
    const input = {
      title: draft.title.trim(),
      groupId: draft.groupId,
      shortcut: draft.shortcut.trim() || null,
      items: draft.items.map(toInput)
    }
    if (draft.id != null) {
      await updateReply.mutateAsync({ id: draft.id, input })
    } else {
      await createReply.mutateAsync(input)
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

  const deleteGroup = (group: QuickReplyGroupVO): void => {
    const warning = group.replyCount > 0 ? `（其下 ${group.replyCount} 条话术将一并删除）` : ''
    if (!window.confirm(`确认删除分组「${group.name}」${warning}？`)) return
    removeGroup.mutate(group.id)
    if (groupId === String(group.id)) setGroupId(ALL)
  }

  const copyReply = async (reply: QuickReplyVO): Promise<void> => {
    await navigator.clipboard.writeText(toPlainText(reply))
    setCopiedId(reply.id)
    window.setTimeout(() => setCopiedId((cur) => (cur === reply.id ? null : cur)), 1600)
    recordUse.mutate(reply.id)
  }

  const records = replies.data ?? []
  const canSave =
    !!draft?.title.trim() && !!draft?.groupId && draft.items.every(itemValid) && draft.items.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <MessagesSquare className="size-5 text-primary" />
            快捷回复
          </h1>
          <p className="text-xs text-muted-foreground">文字 / 图片 / 名片多组件话术，一键复制到会话窗口</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setGroupDraft({ name: '' })}>
            <Plus className="size-4" />
            新建分组
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新建话术
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-3">
        <Input
          className="w-56 max-w-full"
          placeholder="搜索标题 / 快捷码"
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
              <span className="ml-1 opacity-70">{group.replyCount}</span>
            </FilterChip>
          ))}
        </div>
        {filteredGroupId != null && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setGroupDraft({ id: filteredGroupId, name: groups.find((g) => g.id === filteredGroupId)?.name ?? '' })}
            >
              <Pencil className="size-3.5" />
              重命名
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => {
                const group = groups.find((g) => g.id === filteredGroupId)
                if (group) deleteGroup(group)
              }}
            >
              <Trash2 className="size-3.5" />
              删除分组
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {replies.isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载话术中…</p>
        ) : records.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            没有符合条件的快捷回复，点击右上角「新建话术」开始添加。
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {records.map((reply) => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                groupName={groups.find((g) => g.id === reply.groupId)?.name}
                copied={copiedId === reply.id}
                onCopy={() => void copyReply(reply)}
                onEdit={() => openEdit(reply)}
                onDelete={() => {
                  if (window.confirm(`确认删除话术「${reply.title}」？`)) removeReply.mutate(reply.id)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reply editor dialog */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id != null ? '编辑快捷回复' : '新建快捷回复'}</DialogTitle>
            <DialogDescription>按顺序拼接多个组件，发送时整体复制到剪贴板。</DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
              <div className="grid grid-cols-[1fr_200px] gap-3">
                <div className="space-y-1.5">
                  <Label>标题</Label>
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="例如：物流查询话术"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>快捷码（可选）</Label>
                  <Input
                    value={draft.shortcut}
                    onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })}
                    placeholder="/hi"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>分组</Label>
                <Select
                  value={draft.groupId != null ? String(draft.groupId) : 'none'}
                  onValueChange={(v) => setDraft({ ...draft, groupId: v === 'none' ? null : Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择分组" />
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>组件（{draft.items.length}）</Label>
                  <div className="flex gap-1">
                    {ITEM_TYPES.map((t) => (
                      <Button
                        key={t}
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem(t)] })}
                      >
                        <Plus className="size-3.5" />
                        {ITEM_TYPE_LABELS[t]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {draft.items.map((item, index) => (
                    <ItemEditor
                      key={index}
                      item={item}
                      index={index}
                      total={draft.items.length}
                      onChange={(next) =>
                        setDraft({ ...draft, items: draft.items.map((cur, i) => (i === index ? next : cur)) })
                      }
                      onMoveUp={() => setDraft({ ...draft, items: move(draft.items, index, index - 1) })}
                      onMoveDown={() => setDraft({ ...draft, items: move(draft.items, index, index + 1) })}
                      onRemove={() =>
                        setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })
                      }
                    />
                  ))}
                  {draft.items.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      还没有组件，点击上方按钮添加文字 / 图片 / 名片。
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              onClick={() => void saveReply()}
              disabled={!canSave || createReply.isPending || updateReply.isPending}
            >
              {createReply.isPending || updateReply.isPending ? '保存中…' : '保存'}
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
                placeholder="例如：售前咨询"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDraft(null)}>
              取消
            </Button>
            <Button
              onClick={() => void saveGroup()}
              disabled={!groupDraft?.name.trim() || createGroup.isPending || updateGroup.isPending}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next
}

function ReplyCard({
  reply,
  groupName,
  copied,
  onCopy,
  onEdit,
  onDelete
}: {
  reply: QuickReplyVO
  groupName?: string
  copied: boolean
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
            {reply.title}
            {reply.shortcut && (
              <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {reply.shortcut}
              </code>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {groupName ?? '未分组'} · {reply.items.length} 个组件 · 已用 {reply.useCount} 次
          </p>
        </div>
        <Button size="sm" variant={copied ? 'secondary' : 'default'} className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={onCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      <div className="flex-1 space-y-2 px-4 py-3">
        {reply.items.map((item) => (
          <ItemPreview key={item.id} item={item} />
        ))}
      </div>

      <div className="flex items-center justify-end gap-1 border-t border-border/60 px-4 py-2">
        <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" title="删除" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function ItemPreview({ item }: { item: QuickReplyItemVO }): React.JSX.Element {
  if (item.type === 2) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-2">
        {item.mediaUrl ? (
          <img src={item.mediaUrl} alt="素材" className="size-12 shrink-0 rounded object-cover" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
            <ImageIcon className="size-5" />
          </span>
        )}
        <Badge variant="outline" className="text-[10px]">
          图片组件
        </Badge>
      </div>
    )
  }
  if (item.type === 3) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CreditCard className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{item.cardName}</p>
          {item.cardPhone && <p className="truncate text-[11px] text-muted-foreground">{item.cardPhone}</p>}
        </div>
      </div>
    )
  }
  return (
    <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-xs leading-relaxed text-foreground">
      {item.content}
    </p>
  )
}

function ItemEditor({
  item,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove
}: {
  item: ItemDraft
  index: number
  total: number
  onChange: (next: ItemDraft) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [pickOpen, setPickOpen] = useState(false)
  const valid = itemValid(item)

  return (
    <div className={cn('rounded-lg border p-3', valid ? 'border-border/60' : 'border-amber-500/60')}>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="gap-1 text-[10px]">
          {item.type === 1 ? <Type className="size-3" /> : item.type === 2 ? <ImageIcon className="size-3" /> : <CreditCard className="size-3" />}
          {ITEM_TYPE_LABELS[item.type]}
        </Badge>
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction title="上移" disabled={index === 0} onClick={onMoveUp}>
            <ArrowUp className="size-3.5" />
          </IconAction>
          <IconAction title="下移" disabled={index === total - 1} onClick={onMoveDown}>
            <ArrowDown className="size-3.5" />
          </IconAction>
          <IconAction title="删除组件" onClick={onRemove} danger>
            <Trash2 className="size-3.5" />
          </IconAction>
        </div>
      </div>

      {item.type === 1 && (
        <textarea
          className="h-20 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={item.content}
          onChange={(e) => onChange({ ...item, content: e.target.value })}
          placeholder="回复正文，支持换行"
        />
      )}

      {item.type === 2 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {item.mediaUrl && (
              <img src={item.mediaUrl} alt="预览" className="size-14 shrink-0 rounded-md border border-border object-cover" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <Input
                value={item.mediaUrl.startsWith('data:') ? '（内嵌本地图片）' : item.mediaUrl}
                onChange={(e) => onChange({ ...item, mediaUrl: e.target.value, materialId: null })}
                placeholder="素材图片 URL，或从素材库选择"
              />
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickOpen(true)}>
                  <ImageIcon className="size-3.5" />
                  从素材库选择
                </Button>
                {(item.mediaUrl || item.materialId != null) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onChange({ ...item, mediaUrl: '', materialId: null })}
                  >
                    清除
                  </Button>
                )}
              </div>
            </div>
          </div>
          <MaterialPicker
            open={pickOpen}
            onOpenChange={setPickOpen}
            onPick={(material) => {
              onChange({ ...item, materialId: material.id, mediaUrl: material.url })
              setPickOpen(false)
            }}
          />
        </div>
      )}

      {item.type === 3 && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={item.cardName}
            onChange={(e) => onChange({ ...item, cardName: e.target.value })}
            placeholder="名片名称"
          />
          <Input
            value={item.cardPhone}
            onChange={(e) => onChange({ ...item, cardPhone: e.target.value })}
            placeholder="联系电话（可选）"
          />
        </div>
      )}
    </div>
  )
}

function MaterialPicker({
  open,
  onOpenChange,
  onPick
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (material: MaterialVO) => void
}): React.JSX.Element {
  const materials = useMaterials({ type: 1 })
  const images = materials.data ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>选择图片素材</DialogTitle>
          <DialogDescription>来自素材库的图片会记录 materialId，并快照当前地址。</DialogDescription>
        </DialogHeader>
        {materials.isPending ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载素材中…</p>
        ) : images.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">素材库里还没有图片，请先到「素材库」添加。</p>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
            {images.map((material) => (
              <button
                key={material.id}
                onClick={() => onPick(material)}
                className="overflow-hidden rounded-lg border border-border/60 text-left transition-colors hover:border-primary"
              >
                <img src={material.url} alt={material.name} className="aspect-square w-full object-cover" />
                <p className="truncate px-2 py-1.5 text-[11px] text-foreground">{material.name}</p>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function IconAction({
  title,
  disabled,
  danger,
  onClick,
  children
}: {
  title: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-30',
        danger ? 'hover:text-destructive' : 'hover:text-foreground'
      )}
    >
      {children}
    </button>
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
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}
