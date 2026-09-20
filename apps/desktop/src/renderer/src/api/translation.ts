import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

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

const SETTINGS_KEY = ['translation-settings'] as const
const NODES_KEY = ['translation-nodes'] as const
const DELAYS_KEY = ['translation-delays'] as const
const STATS_KEY = ['translation-cache-stats'] as const

export function useTranslationSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => http.get<TranslationSettingVO>('/api/translation/settings')
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
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data)
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}

export function useTrialTranslate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { text: string; type: TranslateType }) =>
      http.post<TranslateVO>('/api/translation/translate', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: STATS_KEY })
  })
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
