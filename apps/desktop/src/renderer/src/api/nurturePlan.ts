// src/renderer/src/api/nurturePlan.ts
//
// B9 互聊养号渲染层出口：计划 CRUD + 执行记录。端点接 A16 script:read/write 判定。
// 人工门（confirm）在服务端执行链入口还会再判一次（requireConfirmed），UI 不是唯一防线。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'

export interface NurturePlan {
  id: number
  name: string
  groupChatKey: string | null
  createGroup: number
  /** JSON 数组文本，如 "[2,6,7]"（入库前已按平台分组+稳定排序）。 */
  accountIds: string | null
  perGroup: number
  materialIds: string | null
  seed: number
  atPoints: string | null
  speakingRounds: number
  intervalMinSec: number
  intervalMaxSec: number
  jitterPct: number
  /** pending（人工门未过）| confirmed | running | paused | done | error | cancelled */
  status: string
  lastRunDate: string | null
}

export interface NurtureRun {
  id: number
  planId: number
  accountId: number
  atPoint: string
  roundIdx: number
  slotIndex: number
  status: string
  msgKey: string | null
  errorDetail: string | null
}

/** 解析后端存的 JSON 数组文本（容错：脏数据不该让页面崩）。 */
export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  const body = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!body) return []
  return body.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

export function useNurturePlans(): UseQueryResult<NurturePlan[], Error> {
  return useQuery({ queryKey: ['nurture', 'plans'], queryFn: () => http.get<NurturePlan[]>('/api/nurture-plans') })
}
export function useNurtureRuns(planId: number | null): UseQueryResult<NurtureRun[], Error> {
  return useQuery({
    queryKey: ['nurture', 'runs', planId],
    queryFn: () => http.get<NurtureRun[]>(`/api/nurture-runs${planId == null ? '' : `?planId=${planId}`}`),
    enabled: planId != null,
    refetchInterval: 15_000
  })
}
export function useNurtureMutations(): {
  create: UseMutationResult<NurturePlan, Error, {
    name?: string; groupChatKey?: string; createGroup?: boolean; accountIds: number[]
    perGroup?: number; materialIds?: number[]; seed?: number; atPoints: string[]; speakingRounds?: number
    intervalMinSec?: number; intervalMaxSec?: number; jitterPct?: number
  }, unknown>
  confirm: UseMutationResult<NurturePlan, Error, number, unknown>
  cancel: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: ['nurture'] }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<NurturePlan>('/api/nurture-plans', b), onSuccess: inv }),
    confirm: useMutation({ mutationFn: (id) => http.post<NurturePlan>(`/api/nurture-plans/${id}/confirm`), onSuccess: inv }),
    cancel: useMutation({ mutationFn: (id) => http.post<void>(`/api/nurture-plans/${id}/cancel`), onSuccess: inv })
  }
}
