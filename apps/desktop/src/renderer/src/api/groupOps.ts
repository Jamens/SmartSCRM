// src/renderer/src/api/groupOps.ts
//
// B18 加群 / B19 踢人渲染层出口。端点接 A16 script:read/write 判定。
// 人工门（join: confirm、kick: approve/reject）是**不可绕过的流程**——UI 把它做成显式动作，
// 但真正的拦截在服务端（requireConfirmed/requireApproved，见 spec §5）。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'
import { parseInviteCodes } from '@shared/groupOps'

// ==================== B18 加群 ====================

export interface JoinTask {
  id: number
  accountId: number
  name: string
  /** pending（人工门未过）| confirmed | running | done | error | cancelled */
  status: string
  intervalMinSec: number
  intervalMaxSec: number
  jitterPct: number
  total: number
  succeeded: number
  failed: number
}
export interface JoinItem {
  id: number
  taskId: number
  inviteCode: string
  groupId: string | null
  groupName: string | null
  status: string
  errorDetail: string | null
}

export function useJoinTasks(): UseQueryResult<JoinTask[], Error> {
  return useQuery({ queryKey: ['groupops', 'join'], queryFn: () => http.get<JoinTask[]>('/api/group-join-tasks') })
}
export function useJoinItems(taskId: number | null): UseQueryResult<JoinItem[], Error> {
  return useQuery({
    queryKey: ['groupops', 'join-items', taskId],
    queryFn: () => http.get<JoinItem[]>(`/api/group-join-tasks/${taskId}/items`),
    enabled: taskId != null
  })
}
export function useJoinMutations(): {
  create: UseMutationResult<JoinTask, Error, { accountId: number; name?: string; inviteCodes: string; intervalMinSec?: number; intervalMaxSec?: number; jitterPct?: number }, unknown>
  confirm: UseMutationResult<JoinTask, Error, number, unknown>
  cancel: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: ['groupops', 'join'] }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<JoinTask>('/api/group-join-tasks', b), onSuccess: inv }),
    confirm: useMutation({ mutationFn: (id) => http.post<JoinTask>(`/api/group-join-tasks/${id}/confirm`), onSuccess: inv }),
    cancel: useMutation({ mutationFn: (id) => http.post<void>(`/api/group-join-tasks/${id}/cancel`), onSuccess: inv })
  }
}

// ==================== B19 踢人 ====================

export interface KickTask {
  id: number
  accountId: number
  groupId: string
  name: string
  status: string
  /** 人工门：pending（待审阅）| approved | rejected */
  approvalStatus: string
  rule: string | null
  total: number
  succeeded: number
  failed: number
}
export interface KickItem {
  id: number
  taskId: number
  participantId: string
  displayName: string | null
  reason: string | null
  status: string
  canRemove: boolean | null
  errorDetail: string | null
}

export function useKickTasks(): UseQueryResult<KickTask[], Error> {
  return useQuery({ queryKey: ['groupops', 'kick'], queryFn: () => http.get<KickTask[]>('/api/group-kick-tasks') })
}
export function useKickItems(taskId: number | null): UseQueryResult<KickItem[], Error> {
  return useQuery({
    queryKey: ['groupops', 'kick-items', taskId],
    queryFn: () => http.get<KickItem[]>(`/api/group-kick-tasks/${taskId}/items`),
    enabled: taskId != null
  })
}
export function useKickMutations(): {
  create: UseMutationResult<KickTask, Error, { accountId: number; groupId: string; name?: string; rule?: string; participantIds: string[] }, unknown>
  approve: UseMutationResult<KickTask, Error, number, unknown>
  reject: UseMutationResult<KickTask, Error, number, unknown>
  cancel: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => {
    void qc.invalidateQueries({ queryKey: ['groupops', 'kick'] })
    void qc.invalidateQueries({ queryKey: ['groupops', 'kick-items'] })
  }
  return {
    create: useMutation({ mutationFn: (b) => http.post<KickTask>('/api/group-kick-tasks', b), onSuccess: inv }),
    approve: useMutation({ mutationFn: (id) => http.post<KickTask>(`/api/group-kick-tasks/${id}/approve`), onSuccess: inv }),
    reject: useMutation({ mutationFn: (id) => http.post<KickTask>(`/api/group-kick-tasks/${id}/reject`), onSuccess: inv }),
    cancel: useMutation({ mutationFn: (id) => http.post<void>(`/api/group-kick-tasks/${id}/cancel`), onSuccess: inv })
  }
}

/** 名单文本 → 成员 ID 数组（与邀请码同一套解析口径：多行/逗号/空白分隔、去空去重）。 */
export const parseParticipantIds = parseInviteCodes
