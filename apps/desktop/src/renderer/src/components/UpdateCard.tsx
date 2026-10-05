import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCheckForUpdate, useDownloadUpdate, useSaveUpdateSource, useUpdateSource } from '@/lib/update'

/**
 * A6 自动更新（设置页里的一节）——**自托管更新源 + 检查 + 下载到本地**，不自动安装。
 *
 * 红线：更新源默认空 = 不检查、不外连（本仓开源，绝不默认指向任何商业云）。用户/部署方
 * 填自己的地址后才拉清单。判定与文案都在 `@shared/update` + i18n，这里只编排交互。
 */
export default function UpdateCard(): React.JSX.Element {
  const { t } = useTranslation()
  const { url: savedUrl, loading } = useUpdateSource()
  const [draft, setDraft] = useState<string | null>(null)
  const save = useSaveUpdateSource()
  const check = useCheckForUpdate()
  const download = useDownloadUpdate()

  // 当前版本从机器档案取（与设备信息卡同一份来源，不额外打请求）。
  const { data: currentVersion } = useQuery({
    queryKey: ['device', 'machine-profile'],
    queryFn: async () => (await window.scrm?.app.getMachineProfile())?.appVersion ?? null,
    staleTime: Infinity
  })

  const url = draft ?? savedUrl
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    save.mutate(url)
  }
  const v = check.data

  return (
    <Card data-testid="update-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="size-4 text-primary" />
          {t('settings.update')}
        </CardTitle>
        <CardDescription>{t('settings.updateDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          {t('settings.updateCurrent', { version: currentVersion ?? '—' })}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="update-url">{t('settings.updateSourceLabel')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="update-url"
              value={url}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('settings.updateSourcePlaceholder')}
              className="flex-1"
              data-testid="update-url-input"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
              {t('settings.updateSourceSave')}
            </Button>
          </div>
        </form>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => check.mutate()}
            disabled={check.isPending || loading}
            data-testid="update-check"
          >
            <RefreshCw className={check.isPending ? 'size-4 animate-spin' : 'size-4'} />
            {t('settings.updateCheck')}
          </Button>
          {v ? (
            <span className="text-xs text-muted-foreground" data-testid="update-verdict">
              {v.status === 'disabled' && t('settings.updateDisabled')}
              {v.status === 'uptodate' && t('settings.updateUpToDate')}
              {v.status === 'error' && t('settings.updateError', { error: v.error ?? '' })}
              {v.status === 'available' &&
                t('settings.updateAvailable', { version: v.latest ?? '', current: v.current })}
            </span>
          ) : null}
        </div>

        {v?.status === 'available' && v.downloadUrl ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-3">
            {v.notes && <p className="text-xs text-muted-foreground">{v.notes}</p>}
            <Button
              size="sm"
              onClick={() => download.mutate(v.downloadUrl as string)}
              disabled={download.isPending}
              data-testid="update-download"
            >
              <Download className="size-4" />
              {t('settings.updateDownload')}
            </Button>
            {download.data ? (
              <p className="text-xs text-muted-foreground" data-testid="update-saved">
                {t('settings.updateSavedTo', { path: download.data })}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
