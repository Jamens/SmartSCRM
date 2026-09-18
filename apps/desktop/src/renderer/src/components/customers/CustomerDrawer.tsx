import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { Trash2, X } from 'lucide-react'
import { platformOf } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import {
  useDeleteCustomer,
  useSetCustomerLabels,
  useUpdateCustomer,
  type CustomerVO,
  type LabelGroupVO
} from '@/api/customers'

interface Props {
  customer: CustomerVO
  tree: LabelGroupVO[]
  onClose: () => void
}

const SEX_OPTIONS = [
  { value: 0, label: '未知' },
  { value: 1, label: '男' },
  { value: 2, label: '女' }
]

function initials(name: string | null): string {
  if (!name) return '?'
  return name.trim().slice(0, 2).toUpperCase()
}

export default function CustomerDrawer({ customer, tree, onClose }: Props): React.JSX.Element {
  const meta = platformOf(customer.platformType)
  const update = useUpdateCustomer()
  const setLabels = useSetCustomerLabels()
  const remove = useDeleteCustomer()

  const [nickname, setNickname] = useState(customer.nickname ?? '')
  const [email, setEmail] = useState(customer.email ?? '')
  const [country, setCountry] = useState(customer.country ?? '')
  const [sex, setSex] = useState(customer.sex)
  const [remark, setRemark] = useState(customer.remark ?? '')
  const [labelIds, setLabelIds] = useState<number[]>(customer.labels.map((l) => l.id))

  useEffect(() => {
    setNickname(customer.nickname ?? '')
    setEmail(customer.email ?? '')
    setCountry(customer.country ?? '')
    setSex(customer.sex)
    setRemark(customer.remark ?? '')
    setLabelIds(customer.labels.map((l) => l.id))
  }, [customer])

  const dirty =
    nickname !== (customer.nickname ?? '') ||
    email !== (customer.email ?? '') ||
    country !== (customer.country ?? '') ||
    sex !== customer.sex ||
    remark !== (customer.remark ?? '')

  const originalLabelIds = customer.labels.map((l) => l.id)
  const labelsDirty =
    labelIds.length !== originalLabelIds.length ||
    labelIds.some((id) => !originalLabelIds.includes(id))

  const saveProfile = async (): Promise<void> => {
    await update.mutateAsync({
      id: customer.id,
      input: {
        nickname: nickname.trim() || null,
        email: email.trim() || null,
        country: country.trim() || null,
        sex,
        remark: remark.trim() || null
      }
    })
  }

  const saveLabels = async (): Promise<void> => {
    await setLabels.mutateAsync({ id: customer.id, labelIds })
  }

  const toggleLabel = (id: number): void => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleDelete = async (): Promise<void> => {
    if (!window.confirm(`确认删除客户「${customer.nickname ?? customer.openId}」？`)) return
    await remove.mutateAsync(customer.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-[26rem] max-w-[90vw] flex-col border-l border-border bg-background shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
          <Avatar className="size-10">
            <AvatarImage src={customer.avatar ?? undefined} />
            <AvatarFallback style={{ backgroundColor: meta?.color }}>
              {initials(customer.nickname)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{customer.nickname ?? '未命名客户'}</p>
            <p className="truncate text-xs text-muted-foreground">{customer.openId}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="关闭">
            <X className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-white"
              style={{ backgroundColor: meta?.color }}
            >
              {meta?.label ?? '未知平台'}
            </span>
            <span>创建于 {dayjs(customer.createdAt).format('YYYY-MM-DD')}</span>
            {customer.lastContactAt && (
              <span>· 最近联系 {dayjs(customer.lastContactAt).format('MM-DD HH:mm')}</span>
            )}
          </div>

          <div className="space-y-3">
            <Field id="nickname" label="昵称">
              <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </Field>
            <Field id="email" label="邮箱">
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="—" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="country" label="国家/地区">
                <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="如 CN" />
              </Field>
              <Field label="性别">
                <div className="flex gap-1.5">
                  {SEX_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSex(opt.value)}
                      className={cn(
                        'flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
                        sex === opt.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field id="remark" label="备注">
              <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="—" />
            </Field>
            {customer.phone && (
              <p className="text-xs text-muted-foreground">
                绑定手机：<span className="text-foreground">{customer.phone}</span>
              </p>
            )}
          </div>

          <Button
            className="mt-3 w-full"
            onClick={() => void saveProfile()}
            disabled={!dirty || update.isPending}
          >
            {update.isPending ? '保存中…' : '保存资料'}
          </Button>

          <Separator className="my-5" />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">标签</h3>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveLabels()}
                disabled={!labelsDirty || setLabels.isPending}
              >
                {setLabels.isPending ? '保存中…' : '保存标签'}
              </Button>
            </div>
            <div className="space-y-3">
              {tree.map((group) => (
                <div key={group.id}>
                  <p className="mb-1 text-xs text-muted-foreground">{group.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.labels.map((label) => {
                      const active = labelIds.includes(label.id)
                      return (
                        <button
                          key={label.id}
                          onClick={() => toggleLabel(label.id)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs transition-colors',
                            active ? 'text-white' : 'border-border text-muted-foreground hover:bg-muted'
                          )}
                          style={active ? { backgroundColor: label.color ?? 'var(--primary)', borderColor: 'transparent' } : undefined}
                        >
                          {label.name}
                        </button>
                      )
                    })}
                    {group.labels.length === 0 && <span className="text-xs text-muted-foreground/60">暂无标签</span>}
                  </div>
                </div>
              ))}
              {tree.length === 0 && <p className="text-xs text-muted-foreground">还没有标签分组。</p>}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border/60 px-5 py-3">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void handleDelete()} disabled={remove.isPending}>
            <Trash2 className="size-4" />
            删除客户
          </Button>
          {setLabels.isError || update.isError ? (
            <span className="flex items-center gap-1 text-xs text-destructive">保存失败，请重试</span>
          ) : null}
        </footer>
      </aside>
    </div>
  )
}

function Field({ id, label, children }: { id?: string; label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
