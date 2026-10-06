import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint, Plus, Trash2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useFingerprintProfiles,
  useFingerprintProfileMutations,
  type FingerprintProfile,
  type FingerprintBrowser,
  type FingerprintOs,
  type FingerprintProfileUpsert,
  type FingerprintStatus
} from '@/api/fingerprintProfile'

/**
 * B14 浏览器指纹配置：指纹档案 CRUD + 模拟生成视图。
 *
 * - 指纹档案表格（增删改查），状态徽章，指纹摘要（时区/分辨率）。
 * - 选中档案 → 右侧看详情 + 「生成指纹」按钮（确定性派生 UA/时区/WebGL/噪声，不探测真实设备）。
 * - 删除走二次确认（破坏性动作，与 B10/B13 纪律一致）。
 *
 * 开源红线：生成指纹是后端确定性模拟（不探测真实设备、不发起真实外连），本页只展示结果。
 */
export default function FingerprintProfilePage(): React.JSX.Element {
  const { t } = useTranslation()
  const list = useFingerprintProfiles()
  const m = useFingerprintProfileMutations()
  const [sel, setSel] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDel, setPendingDel] = useState<number | null>(null)

  const rows = list.data ?? []
  const selected = rows.find((p) => p.id === sel) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Fingerprint className="size-5 text-primary" />
            {t('fingerprint.title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('fingerprint.desc')}</p>
        </div>
        <Button size="sm" disabled={creating} onClick={() => { setCreating(true); setSel(null) }} data-testid="fp-new">
          <Plus className="mr-1 size-3.5" />{t('fingerprint.newProfile')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
          {/* 指纹档案表格 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('fingerprint.table.title')}</CardTitle>
              <CardDescription>{t('fingerprint.table.desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm" data-testid="fp-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">{t('fingerprint.table.name')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('fingerprint.table.platform')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('fingerprint.table.status')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('fingerprint.table.summary')}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((p) => (
                    <tr key={p.id} data-testid={`fp-row-${p.id}`} className={sel === p.id ? 'bg-muted/40' : ''}>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:text-primary"
                          onClick={() => { setSel(p.id); setCreating(false) }} data-testid={`fp-select-${p.id}`}>
                          {p.name}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {t(`fingerprint.os.${p.os}`)} · {t(`fingerprint.browser.${p.browser}`)}
                      </td>
                      <td className="px-2 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-2 py-2 text-xs text-muted-foreground" data-testid={`fp-summary-${p.id}`}>
                        {p.timezone
                          ? <span>{p.timezone} · {p.screenResolution}</span>
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" className="text-primary hover:opacity-80 disabled:opacity-40"
                          disabled={m.regenerate.isPending}
                          onClick={() => m.regenerate.mutate(p.id)} data-testid={`fp-gen-${p.id}`}>
                          <RefreshCw className="size-4" />
                        </button>
                        <button type="button" className="ml-2 text-destructive hover:opacity-80"
                          onClick={() => setPendingDel(p.id)} data-testid={`fp-del-${p.id}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {t('fingerprint.table.empty')}</td></tr>
                  )}
                </tbody>
              </table>

              {/* 删除二次确认 */}
              {pendingDel != null && (
                <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2" data-testid="fp-confirm">
                  <p className="text-sm font-medium text-destructive">{t('fingerprint.confirm.deleteTitle')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('fingerprint.confirm.deleteDesc')}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="destructive" disabled={m.remove.isPending}
                      onClick={() => { m.remove.mutate(pendingDel); setPendingDel(null) }} data-testid="fp-confirm-yes">
                      {t('fingerprint.confirm.yes')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={m.remove.isPending}
                      onClick={() => setPendingDel(null)} data-testid="fp-confirm-no">
                      {t('fingerprint.confirm.no')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右栏：新建 / 详情+模拟生成 */}
          <div className="flex flex-col gap-4">
            {creating ? (
              <FingerprintForm
                mode="create"
                onSubmit={(b) => { m.create.mutate(b, { onSuccess: () => setCreating(false) }) }}
                onCancel={() => setCreating(false)}
              />
            ) : selected ? (
              <>
                <FingerprintDetail profile={selected}
                  onGenerate={() => m.regenerate.mutate(selected.id)} generating={m.regenerate.isPending} />
                <FingerprintForm
                  mode="edit"
                  initial={selected}
                  onSubmit={(b) => m.update.mutate({ id: selected.id, body: b })}
                  onCancel={() => undefined}
                />
              </>
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground" data-testid="fp-hint">
                  {t('fingerprint.table.selectHint')}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: FingerprintStatus }): React.JSX.Element {
  const map: Record<FingerprintStatus, { v: 'default' | 'outline'; k: string }> = {
    active: { v: 'default', k: 'active' },
    inactive: { v: 'outline', k: 'inactive' }
  }
  const { v, k } = map[status] ?? map.inactive
  return <Badge variant={v}>{k}</Badge>
}

const OSES: FingerprintOs[] = ['windows', 'macos', 'linux', 'android', 'ios']
const BROWSERS: FingerprintBrowser[] = ['chrome', 'firefox', 'safari', 'edge']
const STATUSES: FingerprintStatus[] = ['active', 'inactive']

function FingerprintForm({ mode, initial, onSubmit, onCancel }: {
  mode: 'create' | 'edit'
  initial?: FingerprintProfile
  onSubmit: (b: FingerprintProfileUpsert) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [os, setOs] = useState<FingerprintOs>(initial?.os ?? 'windows')
  const [browser, setBrowser] = useState<FingerprintBrowser>(initial?.browser ?? 'chrome')
  const [status, setStatus] = useState<FingerprintStatus>(initial?.status ?? 'inactive')
  const [remark, setRemark] = useState(initial?.remark ?? '')

  const submit = (): void => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      os,
      browser,
      status,
      remark: remark.trim() || null
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'create' ? t('fingerprint.form.createTitle') : t('fingerprint.form.editTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fingerprint.form.name')} data-testid="fp-name" />
        <div className="flex gap-2">
          <select value={os} onChange={(e) => setOs(e.target.value as FingerprintOs)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="fp-os">
            {OSES.map((o) => <option key={o} value={o}>{t(`fingerprint.os.${o}`)}</option>)}
          </select>
          <select value={browser} onChange={(e) => setBrowser(e.target.value as FingerprintBrowser)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="fp-browser">
            {BROWSERS.map((b) => <option key={b} value={b}>{t(`fingerprint.browser.${b}`)}</option>)}
          </select>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as FingerprintStatus)} className="rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="fp-status">
          {STATUSES.map((s) => <option key={s} value={s}>{t(`fingerprint.status.${s}`)}</option>)}
        </select>
        <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t('fingerprint.form.remark')} data-testid="fp-remark" />
        <div className="flex gap-2">
          <Button size="sm" disabled={!name.trim()} onClick={submit} data-testid="fp-submit">{t('fingerprint.form.submit')}</Button>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="fp-cancel">{t('fingerprint.form.cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 选中档案的详情 + 模拟生成指纹。生成是后端确定性模拟（不探测真实设备），展示 UA/时区/WebGL/噪声等。
 */
function FingerprintDetail({ profile, onGenerate, generating }: {
  profile: FingerprintProfile
  onGenerate: () => void
  generating: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const generated = profile.generatedAt != null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{profile.name}</CardTitle>
        <CardDescription>{t(`fingerprint.os.${profile.os}`)} · {t(`fingerprint.browser.${profile.browser}`)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <button type="button" onClick={onGenerate} disabled={generating}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
          data-testid={`fp-gen-detail-${profile.id}`}>
          <RefreshCw className="size-3.5" />{t('fingerprint.detail.generate')}
        </button>
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid={`fp-detail-${profile.id}`}>
          {generated ? (
            <div className="flex flex-col gap-1 text-muted-foreground">
              <span className="break-all"><span className="text-foreground/70">{t('fingerprint.detail.userAgent')}:</span> {profile.userAgent}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.screen')}:</span> {profile.screenResolution}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.timezone')}:</span> {profile.timezone}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.locale')}:</span> {profile.locale}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.webglVendor')}:</span> {profile.webglVendor}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.webglRenderer')}:</span> {profile.webglRenderer}</span>
              <span className="break-all"><span className="text-foreground/70">{t('fingerprint.detail.canvas')}:</span> {profile.canvasNoise}</span>
              <span className="break-all"><span className="text-foreground/70">{t('fingerprint.detail.audio')}:</span> {profile.audioNoise}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.hardwareConcurrency')}:</span> {profile.hardwareConcurrency}</span>
              <span><span className="text-foreground/70">{t('fingerprint.detail.deviceMemory')}:</span> {profile.deviceMemory} GB</span>
              <span className="text-[10px] opacity-70">{t('fingerprint.detail.simNote')}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t('fingerprint.detail.notGenerated')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
