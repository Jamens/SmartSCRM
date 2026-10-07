import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
import { useCreateAccount, useAccounts, type AccountInput } from '@/stores/accounts'
import { useTenantInfo } from '@/api/tenant'
import { usePlanDialog } from '@/stores/planDialog'
import { isOverLimit, type PlanResource, type PlanUsage } from '@/lib/planGuard'
import PlanOverLimitDialog from '@/components/PlanOverLimitDialog'

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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateAccount()
  const { data: tenant } = useTenantInfo()
  const { data: accounts } = useAccounts()
  const openPlan = usePlanDialog((s) => s.openPlan)
  const [platformType, setPlatformType] = useState<PlatformType>(PlatformType.WhatsApp)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  const [pendingInput, setPendingInput] = useState<AccountInput | null>(null)
  const [overResource, setOverResource] = useState<PlanResource | null>(null)

  const reset = (): void => {
    setPlatformType(PlatformType.WhatsApp)
    setName('')
    setPhone('')
    setRemark('')
  }

  const doCreate = async (input: AccountInput): Promise<void> => {
    const created = await create.mutateAsync(input)
    onCreated?.(created.viewId)
    reset()
    onOpenChange(false)
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
    // B12 软阻断：席位已达套餐上限时先弹本地提示，不阻断后端——选「仍要继续」照样放行。
    const usage: PlanUsage = {
      seats: accounts?.length ?? 0,
      aiTokens: tenant?.aiTokenUsed ?? 0,
      translation: tenant?.translationCharUsed ?? 0
    }
    if (isOverLimit(tenant, usage, 'seat')) {
      setPendingInput(input)
      setOverResource('seat')
      return
    }
    await doCreate(input)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('account.add.title')}</DialogTitle>
          <DialogDescription>{t('account.add.desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('account.add.platformType')}</Label>
            <Select value={String(platformType)} onValueChange={(v) => setPlatformType(Number(v) as PlatformType)}>
              <SelectTrigger>
                <SelectValue placeholder={t('account.add.platformPlaceholder')} />
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
            <Label htmlFor="acct-name">{t('account.add.nameLabel')}</Label>
            <Input
              id="acct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('account.add.namePlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-phone">{t('account.add.phoneLabel')}</Label>
            <Input
              id="acct-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('account.add.phonePlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-remark">{t('account.add.remarkLabel')}</Label>
            <Input
              id="acct-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={t('account.add.remarkPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            {create.isPending ? t('account.add.submitting') : t('account.add.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* B12 软阻断：席位超限时弹本地提示。「仍要继续」放行原动作，「去升级」跳首页打开升级弹窗，ESC/X 关闭视为放弃。 */}
      <PlanOverLimitDialog
        open={overResource !== null}
        resource={overResource ?? 'seat'}
        planName={tenant?.planName ?? null}
        onProceed={() => {
          const input = pendingInput
          setOverResource(null)
          setPendingInput(null)
          if (input) void doCreate(input)
        }}
        onUpgrade={() => {
          setOverResource(null)
          setPendingInput(null)
          onOpenChange(false)
          openPlan()
          navigate('/home')
        }}
        onClose={() => {
          setOverResource(null)
          setPendingInput(null)
        }}
      />
    </Dialog>
  )
}
