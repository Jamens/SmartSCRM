import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Coins,
  Database,
  KeyRound,
  Languages,
  RotateCw,
  Send,
  Shield,
  Zap
} from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  type TranslationSettingVO
} from '@/api/translation'
import {
  ENGINE_LANGUAGES,
  TRANSLATION_CHANNELS,
  channelProvider,
  languageName,
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

function delayText(delay: number | null): string {
  return delay === null ? '不可达' : `${delay} ms`
}

export default function TranslationPage(): React.JSX.Element {
  const settingsQuery = useTranslationSettings()
  const nodesQuery = useTranslationNodes()
  const statsQuery = useTranslationCacheStats()
  const credentialsQuery = useTranslationCredentials()
  const updateSettings = useUpdateTranslationSettings()
  const [measureOn, setMeasureOn] = useState(true)
  const delaysQuery = useTranslationDelays(measureOn)
  const [draft, setDraft] = useState<TranslationSettingVO | null>(null)

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data)
  }, [settingsQuery.data, draft])

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
          {settingsQuery.isPending ? '加载翻译设置中…' : '翻译设置读取失败，请确认后端已启动。'}
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
            title="接收翻译"
            description="会话气泡下的译文（含自己发出的消息，R1）"
            enabled={settings.receiveEnabled}
            onToggle={(v) => void patch({ receiveEnabled: v })}
            from={settings.receiveFromLang}
            to={settings.receiveToLang}
            channel={settings.channel}
            onFrom={(v) => void patch({ receiveFromLang: v })}
            onTo={(v) => void patch({ receiveToLang: v })}
            extra={
              <ToggleRow
                label="语音翻译"
                hint="本期不生效"
                checked={settings.voiceEnabled}
                onChange={(v) => void patch({ voiceEnabled: v })}
              />
            }
          />
          <DirectionCard
            title="发送翻译"
            description="输入框的发送前预览语向"
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
                  label="实时预览"
                  checked={settings.previewEnabled}
                  onChange={(v) => void patch({ previewEnabled: v })}
                />
                <ToggleRow
                  label="回车即译即发"
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
                风控
              </CardTitle>
              <CardDescription>注入层按推送的开关提示或拦截</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ToggleRow
                label="提示译文含中文"
                checked={settings.disableChinese}
                onChange={(v) => void patch({ disableChinese: v })}
              />
              <ToggleRow
                label="含中文时拦截发送"
                hint="开启后若消息含中文将拦截发送并提示"
                checked={settings.disableChinesePreventSend}
                onChange={(v) => void patch({ disableChinesePreventSend: v })}
              />
            </CardContent>
          </Card>
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
                  节点测速
                </CardTitle>
                <CardDescription>模拟延迟，不产生任何网络请求</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={remeasure}>
                <RotateCw className="size-3.5" />
                重新测速
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
                      {delayText(node.delay)}
                    </Badge>
                  </div>
                )
              })}
              {settings.serverMode === AUTO && choice && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  自动选优结果：<span className="font-semibold text-primary">{choice.server}</span>
                  （当前 <span className="font-semibold">{settings.server}</span>{' '}
                  已是最小时保持不变）
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
  const badge = !online
    ? '模拟通道'
    : onlineReady
      ? `线上 · ${channelLabel ?? ''}`
      : '线上未就绪 · 模拟兜底'
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Languages className="size-5 text-primary" />
          翻译中心
        </h1>
        <p className="text-xs text-muted-foreground">
          语向、渠道与生效节点由后端按账号设置解析，页面只做配置
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

/** radix 的 SelectItem 不接受空串 value，用 `auto` 作哨兵并在边界换回 `''`。 */
const AUTO_SOURCE = 'auto'

function LangSelect({
  value,
  options,
  allowAuto,
  onChange
}: {
  value: string
  options: { code: string; zh: string }[]
  allowAuto?: boolean
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <Select
      value={allowAuto && value === '' ? AUTO_SOURCE : value}
      onValueChange={(v) => onChange(v === AUTO_SOURCE ? '' : v)}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue placeholder="自动检测" />
      </SelectTrigger>
      <SelectContent>
        {allowAuto && <SelectItem value={AUTO_SOURCE}>自动检测</SelectItem>}
        {options.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {languageName(lang.code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const delayOf = (name: string): number | null =>
    delays.find((d) => d.name === name)?.delay ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" />
          节点与线路
        </CardTitle>
        <CardDescription>
          节点只影响测速与自动选优；模拟线路译文由本地引擎生成，线上线路（百度/腾讯）需配置密钥
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">生效节点</span>
          <Badge variant="outline" className="border-0 bg-primary/10 text-primary">
            {settings.serverMode === AUTO ? `auto · ${choice?.server ?? settings.server}` : settings.server}
          </Badge>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onAuto}>
            按测速重选
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
                {node.name} · {delay === null ? '不可达' : `${delay}ms`}
                {incompatible && ' · 仅 Google'}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">线路</span>
          <div className="flex flex-wrap gap-1.5">
            {TRANSLATION_CHANNELS.map((channel) => {
              const provider = channelProvider(channel.code)
              const needsKey = provider !== null && !configuredProviders.has(provider)
              return (
                <button
                  key={channel.code}
                  type="button"
                  title={needsKey ? '未配置密钥，先在下方「密钥配置」填写' : undefined}
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
                  {provider && (needsKey ? ' · 未配置' : ' · 线上')}
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
  const sources = sourceLanguagesFor(channel)
  const targets = targetLanguagesFor(channel)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleRow label="启用" checked={enabled} onChange={onToggle} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">源语言</Label>
            <LangSelect value={from} allowAuto options={sources} onChange={onFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">目标语言</Label>
            <LangSelect value={to} options={targets} onChange={onTo} />
          </div>
        </div>
        {!ENGINE_LANGUAGES.includes(to) && (
          <p className="text-[11px] text-amber-600">
            该语向超出模拟词典范围，译文会按原文返回并标 partial。
          </p>
        )}
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="size-4 text-gold" />
          译文缓存
        </CardTitle>
        <CardDescription>按租户隔离，键形如 type-channel-from-to-hash</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading || !stats ? (
          <p className="py-4 text-center text-xs text-muted-foreground">读取中…</p>
        ) : (
          <>
            <div className="flex gap-3 text-xs">
              <span className="rounded-lg bg-muted px-2 py-1">
                键数 <b className="text-foreground">{stats.totalKeys}</b>
              </span>
              <span className="rounded-lg bg-muted px-2 py-1">
                总命中 <b className="text-foreground">{stats.totalHits}</b>
              </span>
            </div>
            {stats.top.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">还没有缓存条目。</p>
            )}
            {stats.top.map((entry) => (
              <div key={entry.cacheKey} className="rounded-lg border border-border/60 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{entry.sourceText}</span>
                  <Badge variant="outline" className="shrink-0 border-0 bg-primary/10 text-primary">
                    {entry.hitCount} 次
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
  const trial = useTrialTranslate()
  const [text, setText] = useState('你好，订单已发货')
  const [type, setType] = useState<TranslateType>('receive')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Send className="size-4 text-primary" />
          翻译试用
        </CardTitle>
        <CardDescription>
          不登录 WhatsApp 也能验证引擎与缓存；走的是当前设置解析出的语向
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入要翻译的文本"
          className="h-8 text-xs"
        />
        <div className="flex items-center gap-2">
          {(['receive', 'send'] as TranslateType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px]',
                type === t
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground'
              )}
            >
              {t === 'receive' ? '接收语向' : '发送语向'}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-auto gap-1.5"
            disabled={!text.trim() || trial.isPending}
            onClick={() => trial.mutate({ text: text.trim(), type })}
          >
            <Send className="size-3.5" />
            翻译
          </Button>
        </div>
        {trial.data && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            <p className="text-foreground">{trial.data.translation}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{trial.data.cached ? '命中缓存' : '新生成'}</span>
              {trial.data.degraded && (
                <span className="text-amber-600" title={trial.data.degradeReason ?? ''}>
                  降级·模拟
                </span>
              )}
              {trial.data.partial && <span className="text-amber-600">partial</span>}
              {trial.data.containsChinese && <span className="text-amber-600">含中文</span>}
              <span>
                {trial.data.fromLangCode || 'auto'} → {trial.data.toLangCode}
              </span>
              <span>渠道 {trial.data.channel}</span>
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
          <p className="text-[11px] text-red-600">翻译请求失败，请检查后端是否运行。</p>
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
    title: '百度翻译',
    appIdLabel: 'App ID',
    appIdPlaceholder: '例：20240101000000001',
    secretLabel: '密钥',
    hint: '翻译开放平台 · 通用翻译 API（线路 5）· 免费额度约 200 万字符/月'
  },
  {
    provider: 'tencent',
    title: '腾讯云 TMT',
    appIdLabel: 'SecretId',
    appIdPlaceholder: '例：AKID****************',
    secretLabel: 'SecretKey',
    regionLabel: '地域（可选）',
    regionPlaceholder: '默认 ap-shanghai',
    hint: '机器翻译 TextTranslate（线路 7）· 免费额度约 500 万字符/月'
  }
]

function KeyConfigCard({
  credentialOf,
  loadError
}: {
  credentialOf: (provider: string) => TranslationCredentialVO | undefined
  loadError: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-primary" />
          密钥配置
        </CardTitle>
        <CardDescription>
          密钥只保存在本地后端，写入后不再回读；留空密钥保存表示保留原值。
          未配置密钥的线上线路自动回退本地模拟引擎并标降级。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadError && (
          <p className="text-[11px] text-red-600">密钥状态读取失败，请确认后端已启动。</p>
        )}
        {PROVIDER_FORMS.map((form) => (
          <ProviderKeyForm key={form.provider} form={form} credential={credentialOf(form.provider)} />
        ))}
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
  const put = usePutCredential()
  const test = useTestCredential()
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [region, setRegion] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [testResult, setTestResult] = useState<CredentialTestVO | null>(null)

  // 后端加载完成后一次性回填非敏感字段（appId/region）；密钥本身永不回读。
  useEffect(() => {
    if (credential && !seeded) {
      setAppId(credential.appId)
      setRegion(credential.region ?? '')
      setSeeded(true)
    }
  }, [credential, seeded])

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
      setTestResult({ ok: false, latencyMs: null, message: '测试请求失败，请确认后端已启动' })
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{form.title}</span>
        <Badge
          variant="outline"
          className={cn('border-0', configured ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')}
        >
          {configured ? '已配置' : '未配置'}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground/80">{form.hint}</span>
      </div>
      <div className={cn('grid gap-2', form.regionLabel ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{form.appIdLabel}</Label>
          <Input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={form.appIdPlaceholder}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{form.secretLabel}</Label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={configured ? '已保存，留空则不修改' : ''}
            className="h-8 text-xs"
          />
        </div>
        {form.regionLabel && (
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{form.regionLabel}</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder={form.regionPlaceholder}
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
          保存
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={!configured || test.isPending}
          onClick={() => void runTest()}
        >
          {test.isPending ? '测试中…' : '测试'}
        </Button>
        {put.isSuccess && <span className="text-[11px] text-emerald-600">已保存</span>}
        {put.isError && (
          <span className="truncate text-[11px] text-red-600">
            {(put.error as Error)?.message ?? '保存失败'}
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
            ? `可用 · ${testResult.latencyMs ?? '?'}ms`
            : `不可用：${testResult.message}`}
        </p>
      )}
    </div>
  )
}
