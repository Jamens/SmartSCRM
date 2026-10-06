// src/renderer/src/api/tenant.ts
// B24 首页「套餐信息卡 / 用量统计卡」所需的当前租户快照（由后端 /api/tenant/info 提供）。
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
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

export function useTenantInfo(): UseQueryResult<TenantInfo, Error> {
  return useQuery({
    queryKey: ['tenant-info'],
    queryFn: () => http.get<TenantInfo>('/api/tenant/info')
  })
}
