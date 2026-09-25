import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'
import {
  settingsKeyOf,
  settingsParamsOf,
  type ConversationSettingsRef,
  type SettingsRef
} from '@/lib/scopeLabel'

export type TranslateType = 'receive' | 'send'

export interface TranslationSettingVO {
  id: number
  server: string
  serverMode: 'auto' | 'manual' | string
  channel: string
  receiveEnabled: boolean
  receiveFromLang: string
  receiveToLang: string
  sendEnabled: boolean
  sendFromLang: string
  sendToLang: string
  voiceEnabled: boolean
  previewEnabled: boolean
  enterToSend: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
  /** 'global' | 'customer' | 'conversation'：这次拿到的设置属于哪一层。 */
  scope: string
  /** scope='customer' 时是客户 id 的字符串形式；scope='conversation' 时是后端成形的会话键（只显示、不解析）；全局为 null。 */
  scopeKey: string | null
  /** true = 该客户没有覆盖行，这份是继承来的全局。 */
  inherited: boolean
}

/**
 * PUT /api/translation/settings 是**局部提交**：每个字段不传就保留库里现值。
 * 所以调用方只带自己改动的那几个字段——整表回写会把别人（或另一个窗口）
 * 在这之后写进库的值盖回去，因为表单手里攥的是打开页面时的那份快照。
 */
export interface TranslationSettingInput {
  server?: string
  serverMode?: string
  channel?: string
  receiveEnabled?: boolean
  receiveFromLang?: string
  receiveToLang?: string
  sendEnabled?: boolean
  sendFromLang?: string
  sendToLang?: string
  voiceEnabled?: boolean
  previewEnabled?: boolean
  enterToSend?: boolean
  disableChinese?: boolean
  disableChinesePreventSend?: boolean
  /** 缺省即写全局；写客户覆盖行时与 `scopeKey` 成对出现。 */
  scope?: string
  scopeKey?: string
  /** 会话档靠这两个字段定位（spec §3.4：不接受客户端拼好的 `scopeKey`）。 */
  accountId?: number
  chatKey?: string
}

export interface TranslationNodeVO {
  id: number
  name: string
  label: string
  url: string
  baseDelayMs: number
  reachable: boolean
}

export interface ServerDelayVO {
  name: string
  delay: number | null
}

export interface TranslateVO {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  type: string
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
  /** 在线线路回退到本地模拟引擎时为 true */
  degraded: boolean
  /** 降级原因：未配置密钥或厂商报错；正常时为 null */
  degradeReason: string | null
  /** 这次翻译**实际**用的那一档：`global` | `customer` | `conversation`（spec §3.1 / §4③）。 */
  scope: string
}

export interface TranslationCredentialVO {
  provider: string
  appId: string
  hasSecret: boolean
  region: string | null
  updatedAt: string | null
}

export interface TranslationCredentialInput {
  provider: string
  appId: string
  secretKey?: string
  region?: string
}

export interface CredentialTestVO {
  ok: boolean
  latencyMs: number | null
  message: string
}

export interface TranslationCacheEntryVO {
  cacheKey: string
  sourceText: string
  targetText: string
  hitCount: number
  partial: boolean
}

export interface TranslationCacheStatsVO {
  totalKeys: number
  totalHits: number
  top: TranslationCacheEntryVO[]
}

/** 整前缀：一档一条缓存，保存/删除后要失效的是"每一档"。导出常量而不是 `settingsKeyOf`，是为了让失效方只能按前缀点名。 */
export const SETTINGS_KEY = ['translation-settings'] as const
const NODES_KEY = ['translation-nodes'] as const
const DELAYS_KEY = ['translation-delays'] as const
const STATS_KEY = ['translation-cache-stats'] as const

/**
 * 读**这一个作用域下的生效行**（不是"这一档有没有行"）。参数必填：每个读设置的地方都要写清它读哪一档，
 * 少写一档就是 P6 那条 bug 类的翻版（`useTranslationSettings(null)` 会静默退化成读全局，
 * 而调用方以为拿到的是"这一位/这一条"的值）。
 */
export function useTranslationSettings(ref: SettingsRef) {
  const params = settingsParamsOf(ref)
  return useQuery({
    queryKey: settingsKeyOf(ref),
    queryFn: () =>
      http.get<TranslationSettingVO>(`/api/translation/settings${params ? `?${params}` : ''}`)
  })
}

export function useTranslationNodes() {
  return useQuery({
    queryKey: NODES_KEY,
    queryFn: () => http.get<TranslationNodeVO[]>('/api/translation/nodes'),
    staleTime: 60_000
  })
}

/** Measuring is on-demand only (no polling): entering the page, "重新测速", after a save. */
export function useTranslationDelays(enabled: boolean) {
  return useQuery({
    queryKey: DELAYS_KEY,
    queryFn: () => http.get<ServerDelayVO[]>('/api/translation/nodes/delays'),
    enabled
  })
}

export function useTranslationCacheStats() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: () => http.get<TranslationCacheStatsVO>('/api/translation/cache/stats')
  })
}

export function useUpdateTranslationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TranslationSettingInput) =>
      http.put<TranslationSettingVO>('/api/translation/settings', input),
    onSuccess: () => {
      // 原来这里是 `setQueryData(SETTINGS_KEY, data)`：那次 PUT 写的到底是哪一层由
      // input.scope 决定，而全局与客户级两份可能同时在屏上。整前缀失效让每层各自重取，
      // 代价是一次 refetch（设置页保存是低频动作），换来的是"改全局不会顺手改掉覆盖行"
      // 这类断言在渲染层也成立。
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}

/**
 * 删掉覆盖行 = 该客户回到全局。Task 6 的 `DELETE /settings/customer/{id}` 返回 `{cleared:0|1}`：
 * `cleared === 0` 也是成功（本来就没有覆盖行），不要拿它当失败提示——那只会让用户以为按钮坏了。
 * 失效走整前缀：与保存同一套理由（两层可能同时挂在屏上）。
 */
export function useResetCustomerTranslationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      http.del<{ cleared: number }>(`/api/translation/settings/customer/${customerId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}

/**
 * 删掉会话档 = 这一条会话回到它下面那一档（客户档，或全局）。与 `useTranslationSettings` 的读侧同一句：
 * 这里交出去的是 `accountId` + `chatKey`，不是那条成形键（spec §3.4），所以拼键的那一处只有一个作者。
 * 走 query 不进路径段：`chatKey` 里带 `@` 与 `.`。`cleared === 0` 也是成功（本来就没有这一档的行）。
 */
export function useResetConversationTranslationSettings(): UseMutationResult<
  { cleared: number },
  Error,
  ConversationSettingsRef,
  unknown
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ref: ConversationSettingsRef) =>
      http.del<{ cleared: number }>(
        `/api/translation/settings/conversation?${settingsParamsOf(ref)}`
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}

export function useTrialTranslate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      text: string
      type: TranslateType
      customerId?: number | null
      accountId?: number
      chatKey?: string
    }) => http.post<TranslateVO>('/api/translation/translate', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: STATS_KEY })
  })
}

/**
 * 整份提交的构造器：`PUT /settings` 本身是**局部提交**（上面 `TranslationSettingInput` 的口径，
 * 翻译中心就只发改动的那几个字段），这里把当前读到的那份 VO 逐字段抄进 input 再叠上 patch，
 * 是为了回复框那一次开关——它可能要落一条**还不存在的客户覆盖行**，整份写让那一行落地时与
 * 用户此刻看到的这份继承值逐字段相同，而不是"服务端按全局行复制 + 本次改动"；全局行在两者之间
 * 被别人改过时这两种结果会分叉。代价是这份快照可能过期，所以只用于"用户正盯着这一层"的场景，
 * 设置页那种高频整表表单仍走只发改动字段。
 * 逐字段列出来而不是解构 rest，是为了让"以后 VO 多了一个字段"必须在这里显式表态。
 */
export function settingsInputOf(
  current: TranslationSettingVO,
  patch: Partial<TranslationSettingInput>
): TranslationSettingInput {
  return {
    server: current.server,
    serverMode: current.serverMode,
    channel: current.channel,
    receiveEnabled: current.receiveEnabled,
    receiveFromLang: current.receiveFromLang,
    receiveToLang: current.receiveToLang,
    sendEnabled: current.sendEnabled,
    sendFromLang: current.sendFromLang,
    sendToLang: current.sendToLang,
    voiceEnabled: current.voiceEnabled,
    previewEnabled: current.previewEnabled,
    enterToSend: current.enterToSend,
    disableChinese: current.disableChinese,
    disableChinesePreventSend: current.disableChinesePreventSend,
    ...patch
  }
}

const CREDENTIALS_KEY = ['translation-credentials'] as const

export function useTranslationCredentials() {
  return useQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: () => http.get<TranslationCredentialVO[]>('/api/translation/credentials')
  })
}

/** 密钥只写不读：保存后返回的是掩码视图（hasSecret），secretKey 留空表示保留旧密钥。 */
export function usePutCredential() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TranslationCredentialInput) =>
      http.put<TranslationCredentialVO>('/api/translation/credentials', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CREDENTIALS_KEY })
  })
}

/** 「测试」按钮：真实向厂商发一条探测请求，失败也返回 200 + ok=false。 */
export function useTestCredential() {
  return useMutation({
    mutationFn: (provider: string) =>
      http.post<CredentialTestVO>('/api/translation/credentials/test', { provider })
  })
}
