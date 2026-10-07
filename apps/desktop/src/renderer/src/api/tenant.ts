// src/renderer/src/api/tenant.ts
// B24 首页「套餐信息卡 / 用量统计卡」所需的当前租户快照（由后端 /api/tenant/info 提供）。
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { http } from '@/lib/http'

export interface TenantInfo {
  name: string | null
  planName: string | null
  /** null = 不限量 */
  seatLimit: number | null
  aiTokenLimit: number | null
  aiTokenUsed: number
  translationCharLimit: number | null
  translationCharUsed: number
}

/** B12 模拟支付门控：后端预设套餐目录（代码 / 价格 / 各项限额）。 */
export interface PlanDef {
  code: string
  price: number
  seatLimit: number | null
  aiTokenLimit: number | null
  translationCharLimit: number | null
}

const TENANT_INFO_KEY = ['tenant-info'] as const

export function useTenantInfo(): UseQueryResult<TenantInfo, Error> {
  return useQuery({
    queryKey: TENANT_INFO_KEY,
    queryFn: () => http.get<TenantInfo>('/api/tenant/info')
  })
}

export function usePlans(): UseQueryResult<PlanDef[], Error> {
  return useQuery({
    queryKey: ['tenant-plans'],
    queryFn: () => http.get<PlanDef[]>('/api/tenant/plans')
  })
}

/**
 * B12 模拟支付门控：模拟支付宝支付完成后，把套餐限额写入当前租户。
 * 真实场景应由支付回调驱动，这里是演示链路（后端只校验套餐代码并落库）。
 */
export function useActivatePlan(): UseMutationResult<TenantInfo, Error, string, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (planCode: string) => http.post<TenantInfo>('/api/tenant/activate-plan', { planCode }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TENANT_INFO_KEY })
  })
}
