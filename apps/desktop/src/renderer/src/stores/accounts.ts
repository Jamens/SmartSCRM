import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { http } from '@/lib/http'
import { PlatformType } from '@/lib/platform'

export interface PlatformAccount {
  id: number
  tenantId: number
  platformType: PlatformType
  name: string
  phone: string | null
  avatar: string | null
  viewId: string
  status: number
  /** 是否已导入会话凭据（免扫码登录）。不携带凭据原文。 */
  hasCredential?: boolean
  remark: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CredentialPayload {
  /** 会话凭据原文（导出的 localStorage JSON），仅专用接口返回。 */
  credential: string | null
}

export interface AccountInput {
  platformType: PlatformType
  name: string
  phone?: string | null
  avatar?: string | null
  viewId: string
  remark?: string | null
}

const ACCOUNTS_KEY = ['platform-accounts'] as const

export function useAccounts(): import("@tanstack/react-query").UseQueryResult<PlatformAccount[], Error> {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => http.get<PlatformAccount[]>('/api/platform-accounts')
  })
}

export function useCreateAccount(): import("@tanstack/react-query").UseMutationResult<PlatformAccount, Error, AccountInput, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AccountInput) => http.post<PlatformAccount>('/api/platform-accounts', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  })
}

export function useDeleteAccount(): import("@tanstack/react-query").UseMutationResult<void, Error, number, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/platform-accounts/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  })
}

export function useUpdateAccountStatus(): import("@tanstack/react-query").UseMutationResult<void, Error, { id: number; status: number; }, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      http.patch<void>(`/api/platform-accounts/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  })
}

/** 读取某账号的会话凭据原文（仅路由层在打开内嵌视图前按需拉取，用于注入 partition）。 */
export function useAccountCredential(id: number | null, enabled: boolean): import("@tanstack/react-query").UseQueryResult<CredentialPayload, Error> {
  return useQuery({
    queryKey: ['account-credential', id],
    queryFn: () => http.get<CredentialPayload>(`/api/platform-accounts/${id}/credential`),
    enabled: enabled && id !== null
  })
}

/** 导入（保存）会话凭据：后端落库，下次打开内嵌视图即注入免扫码登录。 */
export function useImportCredential(): import("@tanstack/react-query").UseMutationResult<void, Error, { id: number; credential: string }, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, credential }: { id: number; credential: string }) =>
      http.post<void>(`/api/platform-accounts/${id}/credential`, { credential }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      void qc.invalidateQueries({ queryKey: ['account-credential', vars.id] })
    }
  })
}

/** 清除已导入的会话凭据。 */
export function useClearCredential(): import("@tanstack/react-query").UseMutationResult<void, Error, number, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/platform-accounts/${id}/credential`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      void qc.invalidateQueries({ queryKey: ['account-credential', id] })
    }
  })
}

interface SelectionState {
  selectedId: number | null
  select: (id: number | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id })
}))
