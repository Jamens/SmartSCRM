import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PLATFORMS, PlatformType } from '@/lib/platform'
import { useCreateAccount, type AccountInput } from '@/stores/accounts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (viewId: string) => void
}

const PLATFORM_ORDER: PlatformType[] = [
  PlatformType.WhatsApp,
  PlatformType.Telegram,
  PlatformType.Facebook,
  PlatformType.Messenger,
  PlatformType.Line,
  PlatformType.AIStar,
  PlatformType.WhatsAppProtocol
]

function newViewId(): string {
  const rand = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
  return `acc-${rand}`
}

export default function AddAccountDialog({ open, onOpenChange, onCreated }: Props): React.JSX.Element {
  const create = useCreateAccount()
  const [platformType, setPlatformType] = useState<PlatformType>(PlatformType.WhatsApp)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')

  const reset = (): void => {
    setPlatformType(PlatformType.WhatsApp)
    setName('')
    setPhone('')
    setRemark('')
  }

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const input: AccountInput = {
      platformType,
      name: name.trim(),
      phone: phone.trim() || null,
      viewId: newViewId(),
      remark: remark.trim() || null
    }
    const created = await create.mutateAsync(input)
    onCreated?.(created.viewId)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增平台账号</DialogTitle>
          <DialogDescription>为当前团队添加一个可内嵌登录的渠道账号。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>平台类型</Label>
            <Select value={String(platformType)} onValueChange={(v) => setPlatformType(Number(v) as PlatformType)}>
              <SelectTrigger>
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_ORDER.map((type) => (
                  <SelectItem key={type} value={String(type)}>
                    {PLATFORMS[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{PLATFORMS[platformType].hint}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-name">显示名称</Label>
            <Input
              id="acct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客服一号"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-phone">绑定号码（可选）</Label>
            <Input
              id="acct-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+86 138 0000 0000"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-remark">备注（可选）</Label>
            <Input
              id="acct-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="用途说明"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            {create.isPending ? '添加中…' : '确认添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
