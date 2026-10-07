// src/renderer/src/components/PlanOverLimitDialog.tsx
// B12 模拟支付门控：超额时的本地拦截提示（软阻断）。
// 只做前端提示、不阻断后端：用户选「仍要继续」照样放行，也不做服务端硬校验。
// 「去升级」会打开与首页用量卡同一个升级弹窗（共享 usePlanDialog store）。
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { planResourceLabelKey, type PlanResource } from '@/lib/planGuard'

interface Props {
  open: boolean
  resource: PlanResource
  planName: string | null
  /** 点「仍要继续」：关闭本弹窗并放行原动作。 */
  onProceed: () => void
  /** 点「去升级」：关闭本弹窗并打开升级 / 充值套餐弹窗。 */
  onUpgrade: () => void
  /** ESC / 点 X 关闭：视为放弃原动作。 */
  onClose: () => void
}

export default function PlanOverLimitDialog({
  open,
  resource,
  planName,
  onProceed,
  onUpgrade,
  onClose
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const planLabel = planName ? t(`plan.${planName}`) : t('overview.defaultPlan')
  const resourceLabel = t(planResourceLabelKey(resource))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            {t('plan.overLimit.title')}
          </DialogTitle>
          <DialogDescription>{t('plan.overLimit.desc', { plan: planLabel, resource: resourceLabel })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onUpgrade}>
            {t('plan.overLimit.upgrade')}
          </Button>
          <Button variant="destructive" onClick={onProceed}>
            {t('plan.overLimit.ignore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}