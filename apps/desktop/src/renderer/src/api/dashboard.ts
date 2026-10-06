// src/renderer/src/api/dashboard.ts
//
// B11 报表仪表盘——总览 + 按账号下钻（端点均接 A16 message:read 判定）。
// 导出 CSV 在渲染层用 @shared/dashboard 的 dashboardCsv + Blob 下载（不经后端，见该文件头注）。
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { http } from '@/lib/http'

export interface DayCount { day: string; inCount: number; outCount: number }
export interface DashboardVO {
  accountsTotal: number
  accountsOnline: number
  customersTotal: number
  conversationsTotal: number
  tasksTotal: number
  tasksRunning: number
  messageTotal: number
  messageIn: number
  messageOut: number
  activeConversations: number
  perDay: DayCount[]
}

export function useDashboard(days = 7): UseQueryResult<DashboardVO, Error> {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => http.get<DashboardVO>(`/api/dashboard/overview?days=${days}`),
    refetchInterval: 60_000
  })
}

/** 下钻：按账号的收发量（谁贡献的），按总量降序。 */
export interface AccountStat {
  accountId: number
  accountName: string
  platform: string
  online: boolean
  messageIn: number
  messageOut: number
  activeConversations: number
}
export function useAccountStats(days = 7): UseQueryResult<AccountStat[], Error> {
  return useQuery({
    queryKey: ['dashboard', 'accounts', days],
    queryFn: () => http.get<AccountStat[]>(`/api/dashboard/accounts?days=${days}`),
    refetchInterval: 60_000
  })
}
