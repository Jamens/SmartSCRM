import { useTranslation } from 'react-i18next'
import { AlertTriangle, LoaderCircle, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { hasArchivedRows, impactRowsOf } from '@/lib/accountImpact'
import { useAccountImpact, useDeleteAccount, type PlatformAccount } from '@/stores/accounts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: PlatformAccount
  /** 删除成功后回调：侧栏据此销毁内嵌视图、清空选中并收起弹层。 */
  onDeleted: () => void
}

export default function DeleteAccountDialog({
  open,
  onOpenChange,
  account,
  onDeleted
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { data, isPending, isError } = useAccountImpact(account.id)
  const remove = useDeleteAccount()
  const deleting = remove.isPending
  const rows = impactRowsOf(data ?? null)

  const confirm = async (): Promise<void> => {
    try {
      await remove.mutateAsync(account.id)
      onDeleted()
    } catch {
      // 失败时弹层不关：错误原文就在下方，用户能立刻看出是哪张表或哪条权限挡住了。
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4" />
            {t('account.delete.title')}
          </DialogTitle>
          <DialogDescription>{t('account.delete.desc', { name: account.name })}</DialogDescription>
        </DialogHeader>

        {isPending && (
          <p className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            {t('account.delete.loading')}
          </p>
        )}

        {isError && (
          <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-500" />
            {t('account.delete.failed')}
          </p>
        )}

        {data &&
          (hasArchivedRows(data) ? (
            <ul className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5">
              {rows.map((row) => (
                <li key={row.key} className="text-xs leading-relaxed text-muted-foreground">
                  {t(`account.delete.${row.key}`, { num: row.count })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              {t('account.delete.empty')}
            </p>
          ))}

        {remove.error && (
          <p className="text-xs text-destructive">{t('account.delete.failedDelete', { msg: remove.error.message })}</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            {t('account.delete.no')}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting && <LoaderCircle className="size-3.5 animate-spin" />}
            {t('account.delete.yes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
