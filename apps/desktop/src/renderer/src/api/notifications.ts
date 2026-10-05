// src/renderer/src/api/notifications.ts
//
// A10 消息中心 / 站内通知的取数与变更出口。列表、未读数、标记已读都在这里，
// 组件不裸调 http（与 customers/groupMembers 同一纪律，避免两份永不刷新的缓存）。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { PageResult } from '@/api/customers'

export interface NotificationVO {
  id: number
  type: string
  title: string
  content: string | null
  link: string | null
  /** 当前用户是否已读（后端按 notification_read 填好，不是表列）。 */
  read: boolean
  createdAt: string
}

export const notificationsKeys = {
  all: ['notifications'] as const,
  list: (page: number, pageSize: number, unreadOnly: boolean) =>
    ['notifications', 'list', page, pageSize, unreadOnly] as const,
  unreadCount: ['notifications', 'unread-count'] as const
}

export function useNotifications(
  page: number,
  pageSize: number,
  unreadOnly: boolean
): UseQueryResult<PageResult<NotificationVO>, Error> {
  return useQuery({
    queryKey: notificationsKeys.list(page, pageSize, unreadOnly),
    queryFn: () =>
      http.get<PageResult<NotificationVO>>(
        `/api/notifications?page=${page}&pageSize=${pageSize}&unreadOnly=${unreadOnly}`
      ),
    refetchInterval: 30_000 // 站内通知靠轮询拿新投递；窗口聚焦时 react-query 也会自动重取
  })
}

/** 未读数：nav 小红点与页头都读它。 */
export function useUnreadCount(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: notificationsKeys.unreadCount,
    queryFn: () => http.get<number>('/api/notifications/unread-count'),
    refetchInterval: 30_000
  })
}

export function useMarkRead(): UseMutationResult<void, Error, number, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.put<void>(`/api/notifications/${id}/read`),
    // 标记已读会同时改列表行的 read 与未读数，两个键一起失效。
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.all })
    }
  })
}

export function useMarkAllRead(): UseMutationResult<number, Error, void, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => http.put<number>('/api/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.all })
    }
  })
}
