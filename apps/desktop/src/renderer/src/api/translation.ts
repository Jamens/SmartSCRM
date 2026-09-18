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

export interface TranslationSettingInput {
  server?: string
  serverMode?: string
  channel?: string
  receiveEnabled?: boolean
  receiveFromLang?: string
  receiveToLang: string
  sendEnabled?: boolean
  sendFromLang?: string
  sendToLang: string
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
