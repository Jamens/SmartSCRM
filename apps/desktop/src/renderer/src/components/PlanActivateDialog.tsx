// src/renderer/src/components/PlanActivateDialog.tsx
// B12 模拟支付门控：升级 / 充值套餐弹窗。三段式——选套餐 → 模拟支付宝支付 → 生效。
// 支付是纯本地模拟（无任何真实外连 / 不产生真实扣款）：点「支付成功」后调用
// POST /api/tenant/activate-plan，由后端把该套餐的 seat / AI / 翻译限额写入当前租户，
// 成功后 invalidate tenant-info，首页用量卡与套餐卡实时刷新。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CreditCard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useActivatePlan, usePlans, useTenantInfo, type PlanDef } from '@/api/tenant'
import { usePlanDialog } from '@/stores/planDialog'

type Phase = 'select' | 'pay' | 'done'

function formatLimit(n: number | null): string {
  return n == null ? '∞' : n.toLocaleString('en-US')
}

export default function PlanActivateDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const { open, closePlan } = usePlanDialog()
  const { data: tenant } = useTenantInfo()
  const { data: plans } = usePlans()
  const activate = useActivatePlan()

  const [phase, setPhase] = useState<Phase>('select')
  const [picked, setPicked] = useState<PlanDef | null>(null)

  // 套餐名按 code 映射到 i18n（plan.BASIC / plan.PRO / plan.FLAGSHIP）。
  const planLabel = (code: string): string => t(`plan.${code}`)

  const close = (): void => {
    closePlan()
    setPhase('select')
    setPicked(null)
  }

  const confirmPaid = async (): Promise<void> => {
    if (!picked) return
    try {
      await activate.mutateAsync(picked.code)
      setPhase('done')
    } catch {
      // 错误通过 activate.isError / activateFailed 展示，不静默。
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('plan.dialog.title')}</DialogTitle>
          <DialogDescription>{t('plan.dialog.desc')}</DialogDescription>
        </DialogHeader>

        {phase === 'select' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('plan.dialog.current')}：{tenant?.planName ? planLabel(tenant.planName) : t('overview.defaultPlan')}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(plans ?? []).map((p) => (
                <div key={p.code} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-sm font-semibold">{planLabel(p.code)}</p>
                  <p className="text-lg font-semibold text-primary">
                    {p.price === 0 ? t('plan.dialog.free') : `¥${p.price}`}
                    <span className="text-xs font-normal text-muted-foreground">{t('plan.dialog.perMonth')}</span>
                  </p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    <li>
                      {t('plan.dialog.seats')}：{formatLimit(p.seatLimit)}
                    </li>
                    <li>
                      {t('plan.dialog.aiTokens')}：{formatLimit(p.aiTokenLimit)}
                    </li>
                    <li>
                      {t('plan.dialog.translation')}：{formatLimit(p.translationCharLimit)}
                    </li>
                  </ul>
                  <Button
                    size="sm"
                    className="mt-auto"
                    onClick={() => {
                      setPicked(p)
                      setPhase('pay')
                    }}
                  >
                    {p.price === 0 ? t('plan.dialog.activate') : t('plan.dialog.payTitle')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'pay' && picked && (
          <div className="flex flex-col items-center gap-4 py-2">
            <CreditCard className="size-10 text-primary" />
            <p className="text-center text-sm text-muted-foreground">{t('plan.dialog.payDesc')}</p>
            <div className="rounded-lg bg-muted px-4 py-3 text-center">
              <p className="text-xs text-muted-foreground">{planLabel(picked.code)}</p>
              <p className="text-xl font-semibold text-primary">
                {picked.price === 0 ? t('plan.dialog.free') : `¥${picked.price}`}
              </p>
            </div>
            {activate.isError && <p className="text-xs text-destructive">{t('plan.dialog.activateFailed')}</p>}
            <Button className="w-full" onClick={() => void confirmPaid()} disabled={activate.isPending}>
              {activate.isPending ? t('plan.dialog.paying') : t('plan.dialog.paySuccess')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase('select')} disabled={activate.isPending}>
              {t('plan.dialog.back')}
            </Button>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="size-10 text-primary" />
            <p className="text-sm font-medium">{t('plan.dialog.activated')}</p>
            <Button className="w-full" onClick={close}>
              {t('plan.dialog.close')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}