// src/renderer/src/api/cloudPhone.ts
//
// B10 云手机渲染层出口：设备 CRUD。端点接 A16 cloudphone:read/write（V37 播种）。
// 拉流是前端 canvas 模拟渲染（按 status + streamSeed 确定性绘制），无后端端点。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type CloudPhoneStatus = 'offline' | 'booting' | 'online' | 'error'

export interface CloudPhone {
  id: number
  tenantId: number
  name: string
  /** generic | vmos（v1 仅展示，不消费）。 */
  provider: string
  /** 连接地址（真实 provider 用，v1 不发起外连）。 */
  host: string | null
  status: CloudPhoneStatus
  androidVersion: string | null
  resolution: string | null
  /** 模拟拉流的确定性种子。 */
  streamSeed: number
  remark: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CloudPhoneUpsert {
  name: string
  provider?: string
  host?: string | null
  status?: CloudPhoneStatus
  androidVersion?: string | null
  resolution?: string | null
  streamSeed?: number | null
  remark?: string | null
}

export function useCloudPhones(): ReturnType<typeof useQuery<CloudPhone[], Error>> {
  return useQuery({
    queryKey: ['cloud-phone', 'list'],
    queryFn: () => http.get<CloudPhone[]>('/api/cloud-phones'),
    refetchInterval: 15_000
  })
}

export function useCloudPhoneMutations(): {
  create: ReturnType<typeof useMutation<CloudPhone, Error, CloudPhoneUpsert, unknown>>
  update: ReturnType<typeof useMutation<CloudPhone, Error, { id: number; body: CloudPhoneUpsert }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => void qc.invalidateQueries({ queryKey: ['cloud-phone'] })
  return {
    create: useMutation({ mutationFn: (b) => http.post<CloudPhone>('/api/cloud-phones', b), onSuccess: inv }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<CloudPhone>(`/api/cloud-phones/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/cloud-phones/${id}`), onSuccess: inv })
  }
}
