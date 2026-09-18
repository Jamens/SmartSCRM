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
  remark: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
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

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => http.get<PlatformAccount[]>('/api/platform-accounts')
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AccountInput) => http.post<PlatformAccount>('/api/platform-accounts', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/platform-accounts/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
  })
}

export function useUpdateAccountStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      http.patch<void>(`/api/platform-accounts/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
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
