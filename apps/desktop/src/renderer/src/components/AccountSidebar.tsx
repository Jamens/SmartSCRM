import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint, KeyRound, Plus, Trash2 } from 'lucide-react'
import { platformOf } from '@/lib/platform'
import { isElectron } from '@/services/viewService'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import AddAccountDialog from '@/components/AddAccountDialog'
import ImportCredentialDialog from '@/components/ImportCredentialDialog'
import DeleteAccountDialog from '@/components/DeleteAccountDialog'
import { useAccounts, useSelectionStore, type PlatformAccount } from '@/stores/accounts'
import { useFingerprintProfiles, useBindAccountFingerprint } from '@/api/fingerprintProfile'

/** 一次待确认的换绑。留着整条账号而不是一个 id：确认文案与重载都要用它的名字和 viewId。 */
interface PendingBind {
  account: PlatformAccount
  /** null = 解绑。 */
  profileId: number | null
}

export default function AccountSidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const { data, isPending, isError } = useAccounts()
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<PlatformAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PlatformAccount | null>(null)
  const [pendingBind, setPendingBind] = useState<PendingBind | null>(null)

  // 档案列表与指纹档案页共用同一个缓存键（['fingerprint-profile','list']）：那边改完这边立刻可见，不多打一次请求。
  const profiles = useFingerprintProfiles()
  const bind = useBindAccountFingerprint()

  const accounts = data ?? []
  const profileRows = profiles.data ?? []

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

  /**
   * 选中了别的档案：不直接发请求，先弹确认（计划 §0-D5）。
   * 换绑必须让新指纹立刻生效，否则就退化成"重启才生效"，而 R3 要的是"只有换绑才变"——
   * 代价是视图会重载，所以这句代价必须在按下之前说清楚，不能等页面白了一下再让用户反应过来。
   */
  const pickProfile = (account: PlatformAccount, raw: string): void => {
    const profileId = raw === '' ? null : Number(raw)
    if (profileId === (account.fingerprintProfileId ?? null)) return
    setPendingBind({ account, profileId })
  }

  const doBind = (): void => {
    if (!pendingBind) return
    const { account, profileId } = pendingBind
    setPendingBind(null)
    bind.mutate(
      { accountId: account.id, profileId },
      {
        onSuccess: () => {
          // 通道名是 wcv-reload，preload 上挂的名字是 view（不是 wcv）。
          // 主进程那边视图不存在时 reload 是空操作，不用先问一遍开没开。
          if (isElectron) void window.scrm?.view.reload(account.viewId)
        }
      }
    )
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
                  {/* 指纹档案（B14）：只选"哪一份"，参数怎么拼是主进程的事（R10）。
                      选空 = 解绑 = 不施加任何指纹（R2）。 */}
                  <select
                    className={`mt-1 w-full truncate rounded border px-1 py-0.5 text-[11px] ${
                      active
                        ? 'border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground'
                        : 'border-border/60 bg-background text-foreground'
                    }`}
                    value={account.fingerprintProfileId == null ? '' : String(account.fingerprintProfileId)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => pickProfile(account, e.target.value)}
                    title={t('account.fingerprint.label')}
                    data-testid={`fp-select-${account.id}`}
                  >
                    <option value="">{t('account.fingerprint.none')}</option>
                    {profileRows.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
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

      {/* 换绑指纹档案的二次确认（D5）：代价是重载丢草稿，必须在按下前讲明白 */}
      {pendingBind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="fp-confirm">
          <div className="w-[320px] rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Fingerprint className="size-4" />
              {t('account.fingerprint.confirmTitle')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('account.fingerprint.confirmDesc', { name: pendingBind.account.name })}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setPendingBind(null)} data-testid="fp-confirm-no">
                {t('account.fingerprint.cancel')}
              </Button>
              <Button size="sm" onClick={doBind} disabled={bind.isPending} data-testid="fp-confirm-yes">
                {t('account.fingerprint.confirmYes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
