// src/renderer/src/components/messages/CustomerDirectionDialog.tsx
import { useState } from 'react'
import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { LangRow } from '@/components/translation/DirectionLangRows'
import {
  settingsInputOf,
  type TranslationSettingVO,
  useResetCustomerTranslationSettings,
  useTranslationSettings,
  useUpdateTranslationSettings
} from '@/api/translation'
import { ApiError } from '@/lib/http'
import { customerRefOf, settingsScopeOf } from '@/lib/scopeLabel'
import { draftOf, dirtyCount, type DirectionDraft } from '@/lib/directionDraft'

interface Props {
  customerId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CustomerDirectionDialog({
  customerId,
  open,
  onOpenChange
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { data } = useTranslationSettings(customerRefOf(customerId))
  const save = useUpdateTranslationSettings()
  const reset = useResetCustomerTranslationSettings()

  // 关闭时清掉两条 mutation 的错误态：Dialog 关闭只卸载 DialogContent，组件本体常驻，
  // `save.isError` 会跨开关残留——重开弹层第一眼看到上一轮的「保存失败」，那是假话。
  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      save.reset()
      reset.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {data ? (
          <DirectionForm
            data={data}
            save={save}
            reset={reset}
            customerId={customerId}
            onOpenChange={handleOpenChange}
          />
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">{t('common.reading')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface FormProps {
  data: TranslationSettingVO
  save: ReturnType<typeof useUpdateTranslationSettings>
  reset: ReturnType<typeof useResetCustomerTranslationSettings>
  customerId: number
  onOpenChange: (open: boolean) => void
}

/**
 * data 到达才挂载：Dialog 关闭时 DialogContent 整棵卸载，重开即重新挂载，
 * `draft` 用 `draftOf(data)` 在挂载时铺一次。这就是原本"打开那一瞬间铺一次、关闭作废再铺"的语义，
 * 只是从 effect 同步 setState 改成了挂载初值（react-hooks/set-state-in-effect 不再触发）。
 */
function DirectionForm({ data, save, reset, customerId, onOpenChange }: FormProps): React.JSX.Element {
  const { t } = useTranslation()
  // 只在"打开的那一瞬间"抓一次初值：`data` 是取值来源，不是"重新铺表单"的触发器。
  // 无条件按 data 铺，一次后台 refetch（保存后的 invalidate、窗口重新聚焦）就会把用户改到一半
  // 的表单抹回服务端值——那种"我刚才选的没了"的手感最难查，所以 `draftOf(data)` 只往空 draft 里铺一次。
  // data 必须留在依赖里：点「语向」时那份查询可能还在飞（徽标与它同一次取数），data 后到却没人
  // 铺表单的话，弹层会永远停在「读取设置中…」，只剩「取消」能用。
  const [draft, setDraft] = useState<DirectionDraft>(() => draftOf(data))

  const patch = (p: Partial<DirectionDraft>): void => setDraft((d) => ({ ...d, ...p }))
  const dirty = dirtyCount(data, draft)

  const submit = (): void => {
    save.mutate(
      settingsInputOf(data, {
        ...draft,
        // 定位那一档的形状由 `scopeLabel` 一处成形（Task 7）：这里再手写一遍 `scopeKey`，
        // 就会有第二个"客户档的键长什么样"的作者。
        ...settingsScopeOf(customerRefOf(customerId))
      }),
      {
        // 成功就关掉：`inherited` 从 true 翻成 false 是这次操作唯一"看得见做完了"的信号，
        // 而它只在重新打开时才该被读一次。留在原地等它翻，等于让表单和缓存赛跑。
        onSuccess: () => onOpenChange(false)
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <Languages className="size-4 text-primary" />
          {t('messages.direction.title')}
        </DialogTitle>
        <DialogDescription>
          {t('messages.direction.desc')}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              data.inherited
                ? 'border-border text-muted-foreground'
                : 'border-0 bg-primary/10 text-primary'
            }
          >
            {data.inherited ? t('messages.direction.inherited') : t('messages.direction.owned')}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {data.inherited
              ? t('messages.direction.inheritedHint')
              : t('messages.direction.ownedHint', { id: customerId })}
          </span>
        </div>

        <LangRow
          title={t('messages.direction.receive')}
          enabled={draft.receiveEnabled}
          onEnabled={(v) => patch({ receiveEnabled: v })}
          from={draft.receiveFromLang}
          to={draft.receiveToLang}
          onFrom={(v) => patch({ receiveFromLang: v })}
          onTo={(v) => patch({ receiveToLang: v })}
          channel={draft.channel}
        />
        <LangRow
          title={t('messages.direction.send')}
          enabled={draft.sendEnabled}
          onEnabled={(v) => patch({ sendEnabled: v })}
          from={draft.sendFromLang}
          to={draft.sendToLang}
          onFrom={(v) => patch({ sendFromLang: v })}
          onTo={(v) => patch({ sendToLang: v })}
          channel={draft.channel}
        />

        {/* 码属性与 `CreateCustomerDialog` 的错误出口同一口径：中文给人读，属性给人判
            （C12——40000 的语种不合法与 50000 的后端炸了不能只剩两种中文）。 */}
        {save.isError && (
          <p
            data-p6-direction-error=""
            data-p6-error-code={save.error instanceof ApiError ? String(save.error.code) : ''}
            className="text-xs text-destructive"
          >
            {t('messages.direction.saveFailed', {
              error: save.error instanceof Error ? save.error.message : t('messages.direction.saveFailedFallback')
            })}
          </p>
        )}
        {/*
          DELETE 失败要单独说一句：按钮从「恢复中…」退回「恢复全局」而界面一字不出，
          用户读到的是"这颗按钮坏了"。标记与保存那条分开——两件事塞进同一个属性，
          读的人就分不出"没删掉"和"没存上"。
        */}
        {reset.isError && (
          <p
            data-p6-direction-reset-error=""
            data-p6-error-code={reset.error instanceof ApiError ? String(reset.error.code) : ''}
            className="text-xs text-destructive"
          >
            {t('messages.direction.resetFailed', {
              error: reset.error instanceof Error ? reset.error.message : t('messages.direction.resetFailedFallback')
            })}
          </p>
        )}
      </div>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <Button
          variant="ghost"
          size="sm"
          data-p6-direction-reset=""
          disabled={!data.inherited || reset.isPending}
          onClick={() => reset.mutate(customerId, { onSuccess: () => onOpenChange(false) })}
        >
          {reset.isPending
            ? t('messages.direction.resetPending')
            : t('messages.direction.reset')}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('messages.direction.cancel')}
          </Button>
          <Button
            size="sm"
            data-p6-direction-save=""
            disabled={dirty === 0 || save.isPending}
            onClick={submit}
          >
            {save.isPending
              ? t('messages.direction.savePending')
              : dirty > 0
                ? t('messages.direction.saveDirty', { count: dirty })
                : t('messages.direction.save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
