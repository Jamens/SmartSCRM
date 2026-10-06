// src/renderer/src/api/dashboard.ts
//
// B11 报表仪表盘——一次 overview 拿齐首页所有指标 + 天级消息趋势（端点接 A16 message:read 判定）。
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
