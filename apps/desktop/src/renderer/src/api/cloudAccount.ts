// src/renderer/src/api/cloudAccount.ts
//
// B21 云账号池渲染层出口：分组 CRUD + 云账号 CRUD + 批量转移 + 同步到本地。
// 端点接 A16 cloudaccount:read/write（V44 播种）。
// 「同步到本地」是后端把云号落成一条本地 platform_account 记录（不外连、不接真实号源），前端只触发与展示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type CloudAccountPlatform = 'whatsapp' | 'telegram' | 'line'
export type CloudAccountStatus = 'online' | 'offline' | 'warming' | 'banned'

export interface CloudAccountGroup {
  id: number
  tenantId: number
  name: string
  remark: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CloudAccount {
  id: number
  tenantId: number
  groupId: number | null
  name: string
  phone: string | null
  platform: CloudAccountPlatform
  status: CloudAccountStatus
  /** 上次同步到本地的时间。 */
  syncedAt: string | null
  /** 同步生成的本地账号 id（platform_account.id）。 */
  syncedAccountId: number | null
  remark: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CloudAccountUpsert {
  name: string
  groupId?: number | null
  phone?: string | null
  platform?: CloudAccountPlatform
  status?: CloudAccountStatus
  remark?: string | null
}

export interface CloudAccountGroupUpsert {
  name: string
  remark?: string | null
}

export function useCloudAccounts(): ReturnType<typeof useQuery<CloudAccount[], Error>> {
  return useQuery({
    queryKey: ['cloud-account', 'list'],
    queryFn: () => http.get<CloudAccount[]>('/api/cloud-accounts'),
    refetchInterval: 15_000
  })
}

export function useCloudAccountGroups(): ReturnType<typeof useQuery<CloudAccountGroup[], Error>> {
  return useQuery({
    queryKey: ['cloud-account-group', 'list'],
    queryFn: () => http.get<CloudAccountGroup[]>('/api/cloud-account-groups'),
    refetchInterval: 15_000
  })
}

export function useCloudAccountMutations(): {
  create: ReturnType<typeof useMutation<CloudAccount, Error, CloudAccountUpsert, unknown>>
  update: ReturnType<typeof useMutation<CloudAccount, Error, { id: number; body: CloudAccountUpsert }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
  transfer: ReturnType<typeof useMutation<number, Error, { ids: number[]; groupId: number | null }, unknown>>
  sync: ReturnType<typeof useMutation<CloudAccount, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => {
    void qc.invalidateQueries({ queryKey: ['cloud-account'] })
    void qc.invalidateQueries({ queryKey: ['cloud-account-group'] })
  }
  return {
    create: useMutation({
      mutationFn: (b) => http.post<CloudAccount>('/api/cloud-accounts', b),
      onSuccess: inv
    }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<CloudAccount>(`/api/cloud-accounts/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({
      mutationFn: (id) => http.del<void>(`/api/cloud-accounts/${id}`),
      onSuccess: inv
    }),
    // 批量转移：把勾选的云号整体挪到目标分组（groupId 为空 = 移出分组）。
    transfer: useMutation({
      mutationFn: ({ ids, groupId }) => http.post<number>('/api/cloud-accounts/transfer', { ids, groupId }),
      onSuccess: inv
    }),
    // 同步到本地：后端落成一条本地账号记录并回写 syncedAt。
    sync: useMutation({
      mutationFn: (id) => http.post<CloudAccount>(`/api/cloud-accounts/${id}/sync`),
      onSuccess: inv
    })
  }
}

export function useCloudAccountGroupMutations(): {
  create: ReturnType<typeof useMutation<CloudAccountGroup, Error, CloudAccountGroupUpsert, unknown>>
  update: ReturnType<typeof useMutation<CloudAccountGroup, Error, { id: number; body: CloudAccountGroupUpsert }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => {
    void qc.invalidateQueries({ queryKey: ['cloud-account-group'] })
    // 删分组会把挂靠的云号置为未分组，故账号列表也要 refresh。
    void qc.invalidateQueries({ queryKey: ['cloud-account'] })
  }
  return {
    create: useMutation({
      mutationFn: (b) => http.post<CloudAccountGroup>('/api/cloud-account-groups', b),
      onSuccess: inv
    }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<CloudAccountGroup>(`/api/cloud-account-groups/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({
      mutationFn: (id) => http.del<void>(`/api/cloud-account-groups/${id}`),
      onSuccess: inv
    })
  }
}
