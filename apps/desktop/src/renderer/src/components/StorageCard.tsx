import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  clearContactCache,
  getCacheMeta,
  isContactCacheEnabled,
  setContactCacheEnabled,
  type ContactCacheMeta
} from '@/lib/contactCache'
import { useAuthStore } from '@/stores/auth'

interface StorageEstimate {
  usage: number
  quota: number
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

type ConfirmKind = 'contacts' | 'local' | 'all'

/**
 * 存储管理卡片（B26）。放在设置页，与 deviceInfo 等卡片同风格。
 * 三档清理都走「两步确认」：先 arm 出确认文案 + 确认/取消，避免误触把缓存/登录清掉。
 */
export default function StorageCard(): React.JSX.Element {
  const { t } = useTranslation()
  const logout = useAuthStore((s) => s.logout)

  const [enabled, setEnabled] = useState<boolean>(() => isContactCacheEnabled())
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [meta, setMeta] = useState<ContactCacheMeta>({ count: 0, lastSync: null })
  const [busy, setBusy] = useState<ConfirmKind | null>(null)
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // 仅给事件处理（清理/开关）用：在 handler 里 setState 不受 effect 规则限制。
  const reload = useCallback(() => {
    void getCacheMeta().then(setMeta)
    if (navigator.storage?.estimate) {
      void navigator.storage
        .estimate()
        .then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
        .catch(() => setEstimate(null))
    }
  }, [])

  // 首屏读缓存元信息 + 存储占用。只在 .then 里 setState（异步），不触发 effect 内的同步 setState 规则。
  useEffect(() => {
    let cancelled = false
    void getCacheMeta().then((m) => {
      if (!cancelled) setMeta(m)
    })
    if (navigator.storage?.estimate) {
      void navigator.storage
        .estimate()
        .then((e) => {
          if (!cancelled) setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
        })
        .catch(() => {
          if (!cancelled) setEstimate(null)
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  const toggleCache = useCallback(
    async (value: boolean): Promise<void> => {
      setEnabled(value)
      setContactCacheEnabled(value)
      // 关闭即清缓存：disabled = 不留本地数据。
      if (!value) {
        await clearContactCache()
        reload()
      }
      setStatus(null)
    },
    [reload]
  )

  const doClearContacts = useCallback(async (): Promise<void> => {
    setBusy('contacts')
    setConfirming(null)
    setStatus(null)
    await clearContactCache()
    reload()
    setStatus(t('settings.storage.cleared'))
    setBusy(null)
  }, [reload, t])

  const doClearLocal = useCallback(async (): Promise<void> => {
    setBusy('local')
    setConfirming(null)
    try {
      localStorage.clear()
    } catch {
      /* 忽略 */
    }
    try {
      await window.scrm?.settings.reset()
    } catch {
      /* 主进程不可达时仍继续登出 */
    }
    // 清掉登录态并回到登录页；下面两行在主进程不可达时作为兜底。
    await logout()
    reload()
    setBusy(null)
  }, [logout, reload])

  const doResetAll = useCallback(async (): Promise<void> => {
    setBusy('all')
    setConfirming(null)
    await clearContactCache()
    try {
      localStorage.clear()
    } catch {
      /* 忽略 */
    }
    try {
      await window.scrm?.settings.reset()
    } catch {
      /* 忽略 */
    }
    await logout()
    reload()
    setBusy(null)
  }, [logout, reload])

  const usageText =
    estimate && (estimate.usage > 0 || estimate.quota > 0)
      ? t('settings.storage.usageValue', {
          used: formatBytes(estimate.usage),
          quota: formatBytes(estimate.quota)
        })
      : t('settings.storage.usageUnknown')

  const lastSyncText =
    meta.lastSync != null
      ? t('settings.storage.lastSync', { time: new Date(meta.lastSync).toLocaleString() })
      : t('settings.storage.lastSyncNever')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-primary" />
          {t('settings.storage.title')}
        </CardTitle>
        <CardDescription>{t('settings.storage.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{t('settings.storage.usage')}</p>
          <p className="mt-1 text-sm font-medium text-foreground" data-testid="storage-usage">
            {usageText}
          </p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="storage-contact-meta">
            {t('settings.storage.contactCacheCount', { count: meta.count })} · {lastSyncText}
          </p>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('settings.storage.cacheToggle')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.storage.cacheToggleDesc')}</p>
          </div>
          <Switch
            aria-label={t('settings.storage.cacheToggle')}
            checked={enabled}
            onCheckedChange={(v) => void toggleCache(v === true)}
            data-testid="contact-cache-toggle"
          />
        </div>

        <div className="h-px bg-border" />

        <StorageAction
          icon={<Trash2 className="size-4" />}
          title={t('settings.storage.clearContacts')}
          desc={t('settings.storage.clearContactsDesc')}
          confirmText={t('settings.storage.confirmContacts')}
          busy={busy === 'contacts'}
          confirming={confirming === 'contacts'}
          onArm={() => {
            setStatus(null)
            setConfirming('contacts')
          }}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void doClearContacts()}
          testId="clear-contacts"
        />

        <StorageAction
          icon={<HardDrive className="size-4" />}
          title={t('settings.storage.clearLocal')}
          desc={t('settings.storage.clearLocalDesc')}
          confirmText={t('settings.storage.confirmLocal')}
          busy={busy === 'local'}
          confirming={confirming === 'local'}
          onArm={() => {
            setStatus(null)
            setConfirming('local')
          }}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void doClearLocal()}
          testId="clear-local"
        />

        <StorageAction
          icon={<RotateCcw className="size-4" />}
          title={t('settings.storage.resetAll')}
          desc={t('settings.storage.resetAllDesc')}
          confirmText={t('settings.storage.confirmAll')}
          busy={busy === 'all'}
          confirming={confirming === 'all'}
          danger
          onArm={() => {
            setStatus(null)
            setConfirming('all')
          }}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void doResetAll()}
          testId="reset-all"
        />

        {status && (
          <p className="text-xs text-emerald-600" data-testid="storage-status">
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StorageAction(props: {
  icon: ReactNode
  title: string
  desc: string
  confirmText: string
  busy: boolean
  confirming: boolean
  danger?: boolean
  onArm: () => void
  onCancel: () => void
  onConfirm: () => void
  testId: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {props.icon}
          {props.title}
        </p>
        <p className="text-xs text-muted-foreground">{props.desc}</p>
      </div>
      <div className="shrink-0">
        {props.confirming ? (
          <div className="flex items-center gap-2">
            <span className="max-w-44 text-right text-xs text-destructive">{props.confirmText}</span>
            <Button
              type="button"
              size="sm"
              variant={props.danger ? 'destructive' : 'default'}
              disabled={props.busy}
              onClick={props.onConfirm}
              data-testid={`${props.testId}-confirm`}
            >
              {props.busy ? t('settings.storage.busy') : t('settings.storage.confirm')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={props.busy}
              onClick={props.onCancel}
              data-testid={`${props.testId}-cancel`}
            >
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={props.danger ? 'destructive' : 'outline'}
            onClick={props.onArm}
            data-testid={`${props.testId}-arm`}
          >
            {props.title}
          </Button>
        )}
      </div>
    </div>
  )
}
