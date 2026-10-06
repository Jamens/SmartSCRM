import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Smartphone, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useCloudPhones,
  useCloudPhoneMutations,
  type CloudPhone,
  type CloudPhoneStatus,
  type CloudPhoneUpsert
} from '@/api/cloudPhone'

/**
 * B10 云手机：设备管理 + 模拟拉流视图。
 *
 * - 设备表格（增删改查），状态徽章。
 * - 选中设备 → 右侧看**模拟拉流**（canvas 按 status + streamSeed 确定性绘制假手机屏；v1 不接真实 VMOS）。
 * - 删除走二次确认（破坏性动作，与今天 B18/B19/B9/B20 纪律一致）。
 *
 * 开源红线：host 字段只存不用，本页不发起任何外连。
 */
export default function CloudPhonePage(): React.JSX.Element {
  const { t } = useTranslation()
  const phones = useCloudPhones()
  const m = useCloudPhoneMutations()
  const [sel, setSel] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDel, setPendingDel] = useState<number | null>(null)

  const rows = phones.data ?? []
  const selected = rows.find((p) => p.id === sel) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Smartphone className="size-5 text-primary" />
            {t('cloudphone.title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('cloudphone.desc')}</p>
        </div>
        <Button size="sm" disabled={creating} onClick={() => { setCreating(true); setSel(null) }} data-testid="cp-new">
          <Plus className="mr-1 size-3.5" />{t('cloudphone.newDevice')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          {/* 设备表格 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cloudphone.table.title')}</CardTitle>
              <CardDescription>{t('cloudphone.table.desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm" data-testid="cp-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">{t('cloudphone.table.name')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('cloudphone.table.provider')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('cloudphone.table.status')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('cloudphone.table.specs')}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((p) => (
                    <tr key={p.id} data-testid={`cp-row-${p.id}`}
                      className={sel === p.id ? 'bg-muted/40' : ''}>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:text-primary"
                          onClick={() => { setSel(p.id); setCreating(false) }} data-testid={`cp-select-${p.id}`}>
                          {p.name}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{t(`cloudphone.provider.${p.provider}`)}</td>
                      <td className="px-2 py-2"><StatusBadge status={p.status} /></td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {[p.androidVersion, p.resolution].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" className="text-destructive hover:opacity-80"
                          onClick={() => setPendingDel(p.id)} data-testid={`cp-del-${p.id}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {t('cloudphone.table.empty')}</td></tr>
                  )}
                </tbody>
              </table>

              {/* 删除二次确认 */}
              {pendingDel != null && (
                <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2" data-testid="cp-confirm">
                  <p className="text-sm font-medium text-destructive">{t('cloudphone.confirm.deleteTitle')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('cloudphone.confirm.deleteDesc')}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="destructive" disabled={m.remove.isPending}
                      onClick={() => { m.remove.mutate(pendingDel); setPendingDel(null) }} data-testid="cp-confirm-yes">
                      {t('cloudphone.confirm.yes')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={m.remove.isPending}
                      onClick={() => setPendingDel(null)} data-testid="cp-confirm-no">
                      {t('cloudphone.confirm.no')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右栏：新建 / 详情+模拟拉流 */}
          <div className="flex flex-col gap-4">
            {creating ? (
              <DeviceForm
                mode="create"
                onSubmit={(b) => { m.create.mutate(b, { onSuccess: () => setCreating(false) }) }}
                onCancel={() => setCreating(false)}
              />
            ) : selected ? (
              <>
                <SimulatedStream status={selected.status} seed={selected.streamSeed} name={selected.name} />
                <DeviceForm
                  mode="edit"
                  initial={selected}
                  onSubmit={(b) => m.update.mutate({ id: selected.id, body: b })}
                  onCancel={() => undefined}
                />
              </>
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-xs text-muted-foreground" data-testid="cp-hint">
                  {t('cloudphone.table.selectHint')}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: CloudPhoneStatus }): React.JSX.Element {
  const map: Record<CloudPhoneStatus, { v: 'default' | 'outline' | 'secondary' | 'destructive'; k: string }> = {
    online: { v: 'default', k: 'online' },
    booting: { v: 'secondary', k: 'booting' },
    offline: { v: 'outline', k: 'offline' },
    error: { v: 'destructive', k: 'error' }
  }
  const { v, k } = map[status] ?? map.offline
  return <Badge variant={v}>{k}</Badge>
}

const STATUSES: CloudPhoneStatus[] = ['offline', 'booting', 'online', 'error']

// 默认拉流种子：模块级生成一次（不在 render 里调 Math.random，避免 react-compiler 的纯函数校验）。
const DEFAULT_SEED = Math.floor(Math.random() * 1000) + 1

function DeviceForm({ mode, initial, onSubmit, onCancel }: {
  mode: 'create' | 'edit'
  initial?: CloudPhone
  onSubmit: (b: CloudPhoneUpsert) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? 'generic')
  const [host, setHost] = useState(initial?.host ?? '')
  const [status, setStatus] = useState<CloudPhoneStatus>(initial?.status ?? 'offline')
  const [android, setAndroid] = useState(initial?.androidVersion ?? '')
  const [resolution, setResolution] = useState(initial?.resolution ?? '')
  const [seed, setSeed] = useState(String(initial?.streamSeed ?? DEFAULT_SEED))
  const [remark, setRemark] = useState(initial?.remark ?? '')

  const submit = (): void => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      provider,
      host: host.trim() || null,
      status,
      androidVersion: android.trim() || null,
      resolution: resolution.trim() || null,
      streamSeed: Number(seed) || 1,
      remark: remark.trim() || null
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'create' ? t('cloudphone.form.createTitle') : t('cloudphone.form.editTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cloudphone.form.name')} data-testid="cp-name" />
        <div className="flex gap-2">
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="cp-provider">
            <option value="generic">{t('cloudphone.provider.generic')}</option>
            <option value="vmos">{t('cloudphone.provider.vmos')}</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as CloudPhoneStatus)} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm" data-testid="cp-status">
            {STATUSES.map((s) => <option key={s} value={s}>{t(`cloudphone.status.${s}`)}</option>)}
          </select>
        </div>
        <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('cloudphone.form.host')} data-testid="cp-host" />
        <div className="flex gap-2">
          <Input value={android} onChange={(e) => setAndroid(e.target.value)} placeholder={t('cloudphone.form.androidVersion')} className="flex-1" />
          <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={t('cloudphone.form.resolution')} className="flex-1" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('cloudphone.form.streamSeed')}
          <Input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} className="w-24" data-testid="cp-seed" />
        </label>
        <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t('cloudphone.form.remark')} />
        <div className="flex gap-2">
          <Button size="sm" disabled={!name.trim()} onClick={submit} data-testid="cp-submit">{t('cloudphone.form.submit')}</Button>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="cp-cancel">{t('cloudphone.form.cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 模拟拉流：canvas 按 status + streamSeed 确定性绘制假手机屏。
 * v1 不接真实 VMOS/RTSP；streamSeed 决定主题色与动画相位（不用 Math.random，渲染稳定可复现）。
 */
function SimulatedStream({ status, seed, name }: { status: CloudPhoneStatus; seed: number; name: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = 320
    const H = 640
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    ctx.scale(dpr, dpr)
    const hue = ((seed % 360) + 360) % 360
    let raf = 0
    const draw = (t: number): void => {
      ctx.clearRect(0, 0, W, H)
      if (status === 'online') {
        ctx.fillStyle = `hsl(${hue}, 28%, 12%)`
        ctx.fillRect(0, 0, W, H)
        const now = new Date()
        const hh = String(now.getHours()).padStart(2, '0')
        const mm = String(now.getMinutes()).padStart(2, '0')
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`${hh}:${mm}`, 12, 20)
        ctx.textAlign = 'right'
        ctx.fillText('100%', W - 12, 20)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(W, 30); ctx.stroke()
        ctx.textAlign = 'center'
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 42px sans-serif'
        ctx.fillText(`${hh}:${mm}`, W / 2, H / 2)
        ctx.font = '12px sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillText(name, W / 2, H / 2 + 22)
        const cols = 3
        const rows = 4
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = W / 2 + (c - (cols - 1) / 2) * 72
            const y = H - 130 + (r - (rows - 1) / 2) * 46
            ctx.fillStyle = `hsl(${(hue + r * 30 + c * 20) % 360}, 60%, 55%)`
            ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill()
          }
        }
        const p = ((t / 1000 + seed) % 3) / 3
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.fillRect(12, H - 44, W - 24, 6)
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`
        ctx.fillRect(12, H - 44, (W - 24) * p, 6)
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText('模拟拉流', W - 12, H - 12)
      } else if (status === 'booting') {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('启动中' + '.'.repeat(1 + Math.floor(t / 400) % 3), W / 2, H / 2)
      } else if (status === 'error') {
        ctx.fillStyle = '#3b0d0d'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#ff6b6b'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('连接失败', W / 2, H / 2)
      } else {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('未连接', W / 2, H / 2)
      }
      raf = requestAnimationFrame(draw)
    }
    // 先同步画一帧：隐藏/离屏窗口下 rAF 会被节流或暂停，若只靠 rAF 循环，
    // canvas 会整块空白（既影响首屏观感，也让自动化像素校验假红）。先落一帧保底。
    draw(0)
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [status, seed, name])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{name}</CardTitle>
        <CardDescription>{status}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <canvas ref={ref} data-testid="cp-stream" className="rounded-md ring-1 ring-border/60" />
      </CardContent>
    </Card>
  )
}
