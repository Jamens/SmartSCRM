import { useMemo, useRef, useState } from 'react'
import {
  Activity,
  Coins,
  Database,
  Image as ImageIcon,
  KeyRound,
  Languages,
  RotateCw,
  Send,
  Shield,
  Zap
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { LangSelect } from '@/components/translation/LangSelect'
import { LangWarning } from '@/components/translation/DirectionLangRows'
import {
  usePutCredential,
  useTestCredential,
  useTranslationCacheStats,
  useTranslationCredentials,
  useTranslationDelays,
  useTranslationNodes,
  useTranslationSettings,
  useTrialTranslate,
  useUpdateTranslationSettings,
  type CredentialTestVO,
  type ServerDelayVO,
  type TranslateType,
  type TranslationCredentialVO,
  type TranslationSettingInput,
  type TranslationSettingVO,
  useImageTranslate,
  useVoiceTranslate
} from '@/api/translation'
import { GLOBAL_REF } from '@/lib/scopeLabel'
import {
  TRANSLATION_CHANNELS,
  channelProvider,
  langWarnings,
  sourceLanguagesFor,
  targetLanguagesFor
} from '@/lib/langData'
import { isNodeCompatible, pickBestNode } from '@/lib/nodeSelect'
import { broadcastTranslationFlags } from '@/lib/translationSync'
import { cn } from '@/lib/utils'

const AUTO = 'auto'

function delayTone(delay: number | null): string {
  if (delay === null) return 'bg-muted text-muted-foreground'
  if (delay < 60) return 'bg-emerald-500/15 text-emerald-600'
  if (delay < 120) return 'bg-amber-500/15 text-amber-600'
  return 'bg-red-500/15 text-red-600'
}

export default function TranslationPage(): React.JSX.Element {
  const { t } = useTranslation()
  const settingsQuery = useTranslationSettings(GLOBAL_REF)
  const nodesQuery = useTranslationNodes()
  const statsQuery = useTranslationCacheStats()
  const credentialsQuery = useTranslationCredentials()
  const updateSettings = useUpdateTranslationSettings()
  const [measureOn, setMeasureOn] = useState(true)
  const delaysQuery = useTranslationDelays(measureOn)
  const [draft, setDraft] = useState<TranslationSettingVO | null>(null)

  // 注意：这里不再用 effect 把 settingsQuery.data 回填进 draft。未编辑时 `settings` 本身就
  // 走 `draft ?? settingsQuery.data` 兜底，显示永远是服务端值；首次编辑由 `patch` 写入 merged，
  // 所以一份"打开即等于 data"的 draft 纯属冗余状态，删掉能消掉 set-state-in-effect。
  const settings = draft ?? settingsQuery.data ?? null
  const delays = delaysQuery.data ?? []
  const nodes = nodesQuery.data ?? []
  const credentials = credentialsQuery.data ?? []
  const credentialOf = (provider: string): TranslationCredentialVO | undefined =>
    credentials.find((c) => c.provider === provider)

  const choice = useMemo(
    () => (settings ? pickBestNode(delays, settings.server, settings.channel) : null),
    [delays, settings]
  )

  /** 测速只在进页、手动、保存后各来一次；关掉再打开 query 就是重新取一次，不做轮询。 */
  function remeasure(): void {
    setMeasureOn(false)
    setTimeout(() => setMeasureOn(true), 0)
  }

  /**
   * 只把改动的那几个字段发给后端（PUT 是局部提交，不传的字段保留库里现值）。
   * 整表回写等于拿"打开页面时的那份快照"去覆盖别人在这之后写进库的值。
   */
  async function patch(next: TranslationSettingInput): Promise<void> {
    if (!settings) return
    const merged = { ...settings, ...next }
    const input: TranslationSettingInput = { ...next }
    // 自动模式下换线路，要用「新线路」重算推荐；本帧的 choice 还是旧线路的，用了就选错节点
    if (merged.serverMode === AUTO && next.channel !== undefined) {
      merged.server = pickBestNode(delays, settings.server, merged.channel).server
      input.server = merged.server
    }
    setDraft(merged)
    const saved = await updateSettings.mutateAsync(input)
    setDraft(saved)
    await broadcastTranslationFlags(saved)
    remeasure()
  }

  if (!settings) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <PageHeader />
        <p className="py-16 text-center text-sm text-muted-foreground">
          {settingsQuery.isPending ? t('translation.loadingSettings') : t('translation.loadFailed')}
        </p>
      </div>
    )
  }

  const nodeLabel = (name: string): string =>
    nodes.find((n) => n.name === name)?.label ?? name

  const providerOfActive = channelProvider(settings.channel)
  const activeIsConfigured =
    providerOfActive === null || (credentialOf(providerOfActive)?.hasSecret ?? false)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PageHeader
        online={providerOfActive !== null}
        onlineReady={activeIsConfigured}
        channelLabel={TRANSLATION_CHANNELS.find((c) => c.code === settings.channel)?.label}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <NodeCard
            settings={settings}
            delays={delays}
            nodes={nodes}
            choice={choice}
            configuredProviders={configuredProviders(credentials)}
            onReselect={(server) => void patch({ server, serverMode: server === AUTO ? AUTO : 'manual' })}
            onChannel={(channel) => void patch({ channel })}
            onAuto={() => void patch({ server: pickBestNode(delays, settings.server, settings.channel).server, serverMode: AUTO })}
          />
          <DirectionCard
            title={t('translation.receiveTitle')}
            description={t('translation.receiveDesc')}
            enabled={settings.receiveEnabled}
            onToggle={(v) => void patch({ receiveEnabled: v })}
            from={settings.receiveFromLang}
            to={settings.receiveToLang}
            channel={settings.channel}
            onFrom={(v) => void patch({ receiveFromLang: v })}
            onTo={(v) => void patch({ receiveToLang: v })}
            extra={
              <ToggleRow
                label={t('translation.voiceTranslation')}
                hint={t('translation.notEffectiveYet')}
                checked={settings.voiceEnabled}
                onChange={(v) => void patch({ voiceEnabled: v })}
              />
            }
          />
          <DirectionCard
            title={t('translation.sendTitle')}
            description={t('translation.sendDesc')}
            enabled={settings.sendEnabled}
            onToggle={(v) => void patch({ sendEnabled: v })}
            from={settings.sendFromLang}
            to={settings.sendToLang}
            channel={settings.channel}
            onFrom={(v) => void patch({ sendFromLang: v })}
            onTo={(v) => void patch({ sendToLang: v })}
            extra={
              <>
                <ToggleRow
                  label={t('translation.realtimePreview')}
                  checked={settings.previewEnabled}
                  onChange={(v) => void patch({ previewEnabled: v })}
                />
                <ToggleRow
                  label={t('translation.enterToSend')}
                  checked={settings.enterToSend}
                  onChange={(v) => void patch({ enterToSend: v })}
                />
              </>
            }
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldIcon />
                {t('translation.riskControl')}
              </CardTitle>
              <CardDescription>{t('translation.riskControlDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ToggleRow
                label={t('translation.warnContainsChinese')}
                checked={settings.disableChinese}
                onChange={(v) => void patch({ disableChinese: v })}
              />
              <ToggleRow
                label={t('translation.blockContainsChinese')}
                hint={t('translation.blockHint')}
                checked={settings.disableChinesePreventSend}
                onChange={(v) => void patch({ disableChinesePreventSend: v })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ImageIcon className="size-4 text-primary" />
                {t('translation.media.title')}
              </CardTitle>
              <CardDescription>{t('translation.media.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ToggleRow
                label={t('translation.media.ocrSwitch')}
                hint={t('translation.media.ocrHint')}
                checked={settings.ocrEnabled}
                onChange={(v) => void patch({ ocrEnabled: v })}
              />
              <ToggleRow
                label={t('translation.media.asrSwitch')}
                hint={t('translation.media.asrHint')}
                checked={settings.asrEnabled}
                onChange={(v) => void patch({ asrEnabled: v })}
              />
            </CardContent>
          </Card>
          <MediaTrialCard />
          <KeyConfigCard
            credentialOf={credentialOf}
            loadError={!credentialsQuery.isPending && credentialsQuery.isError}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="size-4 text-gold" />
                  {t('translation.nodeSpeedTest')}
                </CardTitle>
                <CardDescription>{t('translation.speedTestDesc')}</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={remeasure}>
                <RotateCw className="size-3.5" />
                {t('translation.remeasure')}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {delays.map((node) => {
                const active =
                  settings.server === node.name ||
                  (settings.serverMode === AUTO && choice?.server === node.name)
                const reason = choice?.skipped.find((s) => s.name === node.name)?.reason
                return (
                  <div
                    key={node.name}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs',
                      active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <span className="w-8 font-semibold text-foreground">{node.name}</span>
                    <span className="flex-1 truncate">{nodeLabel(node.name)}</span>
                    {reason && (
                      <span className="text-[11px] text-muted-foreground/80">{reason}</span>
                    )}
                    <Badge variant="outline" className={cn('border-0', delayTone(node.delay))}>
                      {node.delay === null ? t('translation.unreachable') : `${node.delay} ms`}
                    </Badge>
                  </div>
                )
              })}
              {settings.serverMode === AUTO && choice && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  {t('translation.autoSelectResult', { server: choice.server, current: settings.server })}
                </p>
              )}
            </CardContent>
          </Card>

          <CacheStatsCard stats={statsQuery.data ?? null} loading={statsQuery.isPending} />
          <TrialCard />
        </div>
      </div>
    </div>
  )
}

/**
 * B25 媒体翻译试用：前端不持久化媒体字节（见 MessageBubble 隐私口径），所以这里由用户从本机选
 * 文件，以 base64 递交后端做 OCR/ASR + 翻译。图片与语音切换为一个 tab；结果区先展示抽取文字，
 * 再展示译文，并标注是否降级到本地模拟引擎。
 */
function MediaTrialCard(): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'image' | 'voice'>('image')
  const [file, setFile] = useState<File | null>(null)
  const [b64, setB64] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageMut = useImageTranslate()
  const voiceMut = useVoiceTranslate()

  function onPick(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    if (mode === 'image' && !f.type.startsWith('image/')) {
      setError(t('translation.media.notImage'))
      return
    }
    if (mode === 'voice' && !f.type.startsWith('audio/')) {
      setError(t('translation.media.notAudio'))
      return
    }
    setError(null)
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      const comma = url.indexOf(',')
      setB64(comma >= 0 ? url.slice(comma + 1) : url)
    }
    reader.readAsDataURL(f)
  }

  function run(): void {
    if (!b64) return
    const mut = mode === 'image' ? imageMut : voiceMut
    mut.mutate({ data: b64, mime: file?.type ?? '', type: 'receive' })
  }

  const result = imageMut.data ?? voiceMut.data
  const pending = imageMut.isPending || voiceMut.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ImageIcon className="size-4 text-primary" />
          {t('translation.media.title')} · {t('translation.trialTitle')}
        </CardTitle>
        <CardDescription>{t('translation.media.inConversationHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {(['image', 'voice'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setFile(null)
                setB64(null)
                setError(null)
                imageMut.reset()
                voiceMut.reset()
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px]',
                mode === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground'
              )}
            >
              {m === 'image' ? t('translation.media.imageTab') : t('translation.media.voiceTab')}
            </button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={() => fileRef.current?.click()}
          >
            {mode === 'image' ? t('translation.media.pickImage') : t('translation.media.pickAudio')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={mode === 'image' ? 'image/*' : 'audio/*'}
            className="hidden"
            onChange={onPick}
          />
        </div>
        {file && <p className="truncate text-[11px] text-muted-foreground">{file.name}</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <Button size="sm" className="w-fit gap-1.5" disabled={!b64 || pending} onClick={run}>
          <Send className="size-3.5" />
          {t('translation.media.translate')}
        </Button>
        {result && (
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            <p>
              <span className="text-muted-foreground">{t('translation.media.extracted')}：</span>
              {result.extractedText}
            </p>
            <p className="text-foreground">
              <span className="text-muted-foreground">{t('translation.media.result')}：</span>
              {result.translation}
            </p>
            <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              {result.degraded && <span className="text-amber-600">{t('translation.media.degradedMock')}</span>}
              {result.degradeReason && <span title={result.degradeReason}>{result.degradeReason}</span>}
              <span>
                {result.fromLangCode || 'auto'} → {result.toLangCode}
              </span>
            </p>
          </div>
        )}
        {(imageMut.isError || voiceMut.isError) && (
          <p className="text-[11px] text-red-600">{t('translation.requestFailed')}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ShieldIcon(): React.JSX.Element {
  return <Shield className="size-4 text-primary" />
}

function PageHeader({
  online,
  onlineReady,
  channelLabel
}: {
  online?: boolean
  onlineReady?: boolean
  channelLabel?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const badge = !online
    ? t('translation.mockChannel')
    : onlineReady
      ? t('translation.onlineWithChannel', { channel: channelLabel ?? '' })
      : t('translation.onlineNotReady')
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Languages className="size-5 text-primary" />
          {t('translation.title')}
        </h1>
        <p className="text-xs text-muted-foreground">
          {t('translation.subtitle')}
        </p>
      </div>
      <Badge variant="outline" className="gap-1.5">
        <Activity className="size-3" />
        {badge}
      </Badge>
    </header>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs font-medium text-foreground">{label}</Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
    </div>
  )
}

function NodeCard({
  settings,
  delays,
  nodes,
  choice,
  configuredProviders,
  onReselect,
  onChannel,
  onAuto
}: {
  settings: TranslationSettingVO
  delays: ServerDelayVO[]
  nodes: { name: string; label: string }[]
  choice: { server: string } | null
  configuredProviders: Set<string>
  onReselect: (server: string) => void
  onChannel: (channel: string) => void
  onAuto: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const delayOf = (name: string): number | null =>
    delays.find((d) => d.name === name)?.delay ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" />
          {t('translation.nodeAndChannel')}
        </CardTitle>
        <CardDescription>
          {t('translation.nodeChannelDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('translation.activeNode')}</span>
          <Badge variant="outline" className="border-0 bg-primary/10 text-primary">
            {settings.serverMode === AUTO ? `auto · ${choice?.server ?? settings.server}` : settings.server}
          </Badge>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onAuto}>
            {t('translation.reselectBySpeed')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((node) => {
            const delay = delayOf(node.name)
            const incompatible = !isNodeCompatible(node.name, settings.channel)
            return (
              <button
                key={node.name}
                type="button"
                disabled={delay === null || incompatible}
                onClick={() => onReselect(node.name)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  settings.server === node.name
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border',
                  (delay === null || incompatible) && 'cursor-not-allowed opacity-40'
                )}
              >
                {node.name} · {delay === null ? t('translation.unreachable') : `${delay}ms`}
                {incompatible && t('translation.googleOnly')}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('translation.channel')}</span>
          <div className="flex flex-wrap gap-1.5">
            {TRANSLATION_CHANNELS.map((channel) => {
              const provider = channelProvider(channel.code)
              const needsKey = provider !== null && !configuredProviders.has(provider)
              return (
                <button
                  key={channel.code}
                  type="button"
                  title={needsKey ? t('translation.configKeyFirst') : undefined}
                  disabled={needsKey}
                  onClick={() => onChannel(channel.code)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    settings.channel === channel.code
                      ? 'border-gold bg-gold/15 text-foreground'
                      : 'border-border text-muted-foreground',
                    needsKey && 'cursor-not-allowed opacity-40'
                  )}
                >
                  {channel.code} {channel.label}
                  {provider && (needsKey ? t('translation.channelUnconfigured') : t('translation.channelOnline'))}
                </button>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DirectionCard({
  title,
  description,
  enabled,
  onToggle,
  from,
  to,
  channel,
  onFrom,
  onTo,
  extra
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  from: string
  to: string
  channel: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const sources = sourceLanguagesFor(channel)
  const targets = targetLanguagesFor(channel)
  const warnings = langWarnings(from, to, channel)
  const warnFor = (side: 'from' | 'to'): string | undefined =>
    warnings.find((w) => w.side === side)?.text
  const fromWarn = warnFor('from')
  const toWarn = warnFor('to')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleRow label={t('translation.enable')} checked={enabled} onChange={onToggle} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('translation.sourceLang')}</Label>
            <LangSelect value={from} allowAuto options={sources} onChange={onFrom} />
            {fromWarn && <LangWarning side="from" text={fromWarn} />}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('translation.targetLang')}</Label>
            <LangSelect value={to} options={targets} onChange={onTo} />
            {toWarn && <LangWarning side="to" text={toWarn} />}
          </div>
        </div>
        {extra}
      </CardContent>
    </Card>
  )
}

function CacheStatsCard({
  stats,
  loading
}: {
  stats: {
    totalKeys: number
    totalHits: number
    top: {
      cacheKey: string
      sourceText: string
      targetText: string
      hitCount: number
      partial: boolean
    }[]
  } | null
  loading: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="size-4 text-gold" />
          {t('translation.cacheTitle')}
        </CardTitle>
        <CardDescription>{t('translation.cacheDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading || !stats ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{t('translation.loading')}</p>
        ) : (
          <>
            <div className="flex gap-3 text-xs">
              <span className="rounded-lg bg-muted px-2 py-1">
                {t('translation.keyCount')} <b className="text-foreground">{stats.totalKeys}</b>
              </span>
              <span className="rounded-lg bg-muted px-2 py-1">
                {t('translation.totalHits')} <b className="text-foreground">{stats.totalHits}</b>
              </span>
            </div>
            {stats.top.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">{t('translation.cacheEmpty')}</p>
            )}
            {stats.top.map((entry) => (
              <div key={entry.cacheKey} className="rounded-lg border border-border/60 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{entry.sourceText}</span>
                  <Badge variant="outline" className="shrink-0 border-0 bg-primary/10 text-primary">
                    {t('translation.hitCount', { count: entry.hitCount })}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.targetText}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground/70">
                  {entry.cacheKey}
                  {entry.partial && <span className="text-amber-600">partial</span>}
                </p>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TrialCard(): React.JSX.Element {
  const { t } = useTranslation()
  const trial = useTrialTranslate()
  const [text, setText] = useState(t('translation.sampleText'))
  const [type, setType] = useState<TranslateType>('receive')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Send className="size-4 text-primary" />
          {t('translation.trialTitle')}
        </CardTitle>
        <CardDescription>
          {t('translation.trialDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('translation.inputPlaceholder')}
          className="h-8 text-xs"
        />
        <div className="flex items-center gap-2">
          {(['receive', 'send'] as TranslateType[]).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => setType(dir)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px]',
                type === dir
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground'
              )}
            >
              {dir === 'receive' ? t('translation.receiveDirection') : t('translation.sendDirection')}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-auto gap-1.5"
            disabled={!text.trim() || trial.isPending}
            onClick={() => trial.mutate({ text: text.trim(), type })}
          >
            <Send className="size-3.5" />
            {t('translation.translate')}
          </Button>
        </div>
        {trial.data && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            <p className="text-foreground">{trial.data.translation}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{trial.data.cached ? t('translation.cacheHit') : t('translation.newlyGenerated')}</span>
              {trial.data.degraded && (
                <span className="text-amber-600" title={trial.data.degradeReason ?? ''}>
                  {t('translation.degradedMock')}
                </span>
              )}
              {trial.data.partial && <span className="text-amber-600">partial</span>}
              {trial.data.containsChinese && (
                <span className="text-amber-600">{t('translation.containsChinese')}</span>
              )}
              <span>
                {trial.data.fromLangCode || 'auto'} → {trial.data.toLangCode}
              </span>
              <span>{t('translation.channelPrefix', { channel: trial.data.channel })}</span>
            </p>
            {trial.data.degraded && trial.data.degradeReason && (
              <p className="mt-1 text-[11px] text-muted-foreground">{trial.data.degradeReason}</p>
            )}
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/70">
              {trial.data.cacheKey}
            </p>
          </div>
        )}
        {trial.isError && (
          <p className="text-[11px] text-red-600">{t('translation.requestFailed')}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** 已保存密钥（hasSecret）的服务商集合，用于线路灰显与页头角标。 */
function configuredProviders(list: TranslationCredentialVO[]): Set<string> {
  return new Set(list.filter((c) => c.hasSecret).map((c) => c.provider))
}

interface ProviderForm {
  provider: 'baidu' | 'tencent'
  title: string
  appIdLabel: string
  appIdPlaceholder: string
  secretLabel: string
  regionLabel?: string
  regionPlaceholder?: string
  hint: string
}

const PROVIDER_FORMS: ProviderForm[] = [
  {
    provider: 'baidu',
    title: 'translation.providerBaidu',
    appIdLabel: 'translation.baiduAppIdLabel',
    appIdPlaceholder: 'translation.appIdPlaceholderBaidu',
    secretLabel: 'translation.baiduSecretLabel',
    hint: 'translation.hintBaidu'
  },
  {
    provider: 'tencent',
    title: 'translation.providerTencent',
    appIdLabel: 'translation.tencentAppIdLabel',
    appIdPlaceholder: 'translation.appIdPlaceholderTencent',
    secretLabel: 'translation.tencentSecretLabel',
    regionLabel: 'translation.regionLabel',
    regionPlaceholder: 'translation.regionPlaceholder',
    hint: 'translation.hintTencent'
  }
]

function KeyConfigCard({
  credentialOf,
  loadError
}: {
  credentialOf: (provider: string) => TranslationCredentialVO | undefined
  loadError: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-primary" />
          {t('translation.keyConfig')}
        </CardTitle>
        <CardDescription>
          {t('translation.keyConfigDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadError && (
          <p className="text-[11px] text-red-600">{t('translation.keyLoadFailed')}</p>
        )}
        {PROVIDER_FORMS.map((form) => {
          const credential = credentialOf(form.provider)
          // credential 从「未加载」到「已加载」换 key 触发重挂载，让 ProviderKeyForm 重新从
          // credential 初始化 appId/region（见其 useState 初值），等价于原 effect 的一次性回填。
          return <ProviderKeyForm key={`${form.provider}-${credential ? 'cfg' : 'empty'}`} form={form} credential={credential} />
        })}
      </CardContent>
    </Card>
  )
}

function ProviderKeyForm({
  form,
  credential
}: {
  form: ProviderForm
  credential?: TranslationCredentialVO
}): React.JSX.Element {
  const { t } = useTranslation()
  const put = usePutCredential()
  const test = useTestCredential()
  const [appId, setAppId] = useState(credential?.appId ?? '')
  const [secret, setSecret] = useState('')
  const [region, setRegion] = useState(credential?.region ?? '')
  const [testResult, setTestResult] = useState<CredentialTestVO | null>(null)

  // 非敏感字段（appId/region）在挂载时用 credential 初始化即可：KeyConfigCard 在 credential
  // 从无到有时换了 key 触发整棵重挂载，state 重新从 credential 初始化；密钥本身永不回读。
  // 无需在 effect 里同步 setState（react-hooks/set-state-in-effect）。

  const configured = credential?.hasSecret === true

  async function save(): Promise<void> {
    try {
      await put.mutateAsync({
        provider: form.provider,
        appId: appId.trim(),
        secretKey: secret.trim(),
        region: region.trim()
      })
      setSecret('')
    } catch {
      // 失败原因经 put.error.message 就地展示
    }
  }

  async function runTest(): Promise<void> {
    setTestResult(null)
    try {
      setTestResult(await test.mutateAsync(form.provider))
    } catch {
      setTestResult({ ok: false, latencyMs: null, message: t('translation.testRequestFailed') })
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{t(form.title)}</span>
        <Badge
          variant="outline"
          className={cn('border-0', configured ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')}
        >
          {configured ? t('translation.configured') : t('translation.unconfigured')}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground/80">{t(form.hint)}</span>
      </div>
      <div className={cn('grid gap-2', form.regionLabel ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{t(form.appIdLabel)}</Label>
          <Input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={t(form.appIdPlaceholder)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{t(form.secretLabel)}</Label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={configured ? t('translation.secretPlaceholder') : ''}
            className="h-8 text-xs"
          />
        </div>
        {form.regionLabel && (
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t(form.regionLabel)}</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder={t(form.regionPlaceholder ?? '')}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={!appId.trim() || put.isPending}
          onClick={() => void save()}
        >
          {t('translation.save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={!configured || test.isPending}
          onClick={() => void runTest()}
        >
          {test.isPending ? t('translation.testing') : t('translation.test')}
        </Button>
        {put.isSuccess && <span className="text-[11px] text-emerald-600">{t('translation.saved')}</span>}
        {put.isError && (
          <span className="truncate text-[11px] text-red-600">
            {(put.error as Error)?.message ?? t('translation.saveFailed')}
          </span>
        )}
      </div>
      {testResult && (
        <p
          className={cn(
            'break-all text-[11px]',
            testResult.ok ? 'text-emerald-600' : 'text-red-600'
          )}
        >
          {testResult.ok
            ? t('translation.testOk', { ms: testResult.latencyMs ?? '?' })
            : t('translation.testUnavailable', { message: testResult.message })}
        </p>
      )}
    </div>
  )
}
