import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { platformOf } from '@/lib/platform'
import { isElectron } from '@/services/viewService'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import AddAccountDialog from '@/components/AddAccountDialog'
import ImportCredentialDialog from '@/components/ImportCredentialDialog'
import DeleteAccountDialog from '@/components/DeleteAccountDialog'
import { useAccounts, useSelectionStore, type PlatformAccount } from '@/stores/accounts'

export default function AccountSidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const { data, isPending, isError } = useAccounts()
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<PlatformAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PlatformAccount | null>(null)

  const accounts = data ?? []

  useEffect(() => {
    if (selectedId === null && accounts.length > 0) select(accounts[0].id)
  }, [accounts, selectedId, select])

  /**
   * 删除已在弹层里落库成功，这里只收尾：内嵌视图是真的挂在主进程上，不销毁就会留在
   * 页面上盖住后面的账号；被删的正好是当前选中项时清空选中，让上面的 effect 归位到第一个。
   */
  const afterDeleted = (): void => {
    if (!deleteTarget) return
    if (isElectron) void window.scrm?.view.destroy(deleteTarget.viewId)
    if (selectedId === deleteTarget.id) select(null)
    setDeleteTarget(null)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border/60 bg-muted/30">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('account.sidebar.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('account.sidebar.channelCount', { count: accounts.length })}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={() => setDialogOpen(true)} title={t('account.sidebar.addTitle')}>
          <Plus className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        {isPending && <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('account.sidebar.loading')}</p>}
        {isError && (
          <p className="px-2 py-4 text-center text-xs text-destructive">
            {t('account.sidebar.loadError')}
          </p>
        )}
        {!isPending && accounts.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t('account.sidebar.empty')}
          </p>
        )}

        <div className="space-y-1 pb-2">
          {accounts.map((account) => {
            const meta = platformOf(account.platformType)
            const Icon = meta?.icon
            const active = account.id === selectedId
            return (
              <div
                key={account.id}
                data-p7-account-row={account.id}
                onClick={() => select(account.id)}
                className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'
                }`}
              >
                {Icon && (
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ backgroundColor: active ? 'rgba(255,255,255,0.18)' : meta?.color }}
                  >
                    <Icon className="size-3.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{account.name}</p>
                  <p
                    className={`truncate text-xs ${
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}
                  >
                    {meta?.label}
                  </p>
                </div>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    account.status === 1 ? 'bg-emerald-400' : active ? 'bg-primary-foreground/40' : 'bg-muted-foreground/40'
                  }`}
                />
                <button
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-primary group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation()
                    setImportTarget(account)
                  }}
                  title={t('account.sidebar.importTitle')}
                >
                  <KeyRound className="size-3.5" />
                </button>
                <button
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(account)
                  }}
                  title={t('account.sidebar.deleteTitle')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <AddAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => undefined}
      />

      {importTarget && (
        <ImportCredentialDialog
          key={importTarget.id}
          open={!!importTarget}
          onOpenChange={(o) => {
            if (!o) setImportTarget(null)
          }}
          account={importTarget}
        />
      )}

      {deleteTarget && (
        <DeleteAccountDialog
          key={deleteTarget.id}
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null)
          }}
          account={deleteTarget}
          onDeleted={afterDeleted}
        />
      )}
    </aside>
  )
}
