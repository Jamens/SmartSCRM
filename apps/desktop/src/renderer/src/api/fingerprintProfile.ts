// src/renderer/src/api/fingerprintProfile.ts
//
// B14 浏览器指纹配置渲染层出口：指纹档案 CRUD + 模拟生成。端点接 A16 fingerprint:read/write（V42 播种）。
// 生成指纹是后端确定性模拟（不探测真实设备，符合开源红线），前端只展示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type FingerprintStatus = 'active' | 'inactive'
export type FingerprintOs = 'windows' | 'macos' | 'linux' | 'android' | 'ios'
export type FingerprintBrowser = 'chrome' | 'firefox' | 'safari' | 'edge'

export interface FingerprintProfile {
  id: number
  tenantId: number
  name: string
  os: FingerprintOs
  browser: FingerprintBrowser
  userAgent: string | null
  screenResolution: string | null
  timezone: string | null
  locale: string | null
  webglVendor: string | null
  webglRenderer: string | null
  canvasNoise: string | null
  audioNoise: string | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  status: FingerprintStatus
  seed: number | null
  /** 上次生成时间。 */
  generatedAt: string | null
  remark: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface FingerprintProfileUpsert {
  name: string
  os?: FingerprintOs
  browser?: FingerprintBrowser
  status?: FingerprintStatus
  remark?: string | null
}

export function useFingerprintProfiles(): ReturnType<typeof useQuery<FingerprintProfile[], Error>> {
  return useQuery({
    queryKey: ['fingerprint-profile', 'list'],
    queryFn: () => http.get<FingerprintProfile[]>('/api/fingerprint-profiles'),
    refetchInterval: 15_000
  })
}

export function useFingerprintProfileMutations(): {
  create: ReturnType<typeof useMutation<FingerprintProfile, Error, FingerprintProfileUpsert, unknown>>
  update: ReturnType<typeof useMutation<FingerprintProfile, Error, { id: number; body: FingerprintProfileUpsert }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
  regenerate: ReturnType<typeof useMutation<FingerprintProfile, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => void qc.invalidateQueries({ queryKey: ['fingerprint-profile'] })
  return {
    create: useMutation({ mutationFn: (b) => http.post<FingerprintProfile>('/api/fingerprint-profiles', b), onSuccess: inv }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<FingerprintProfile>(`/api/fingerprint-profiles/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/fingerprint-profiles/${id}`), onSuccess: inv }),
    // 模拟生成指纹：写回生成结果，成功后刷新列表以展示 UA/时区/WebGL/噪声等。
    regenerate: useMutation({ mutationFn: (id) => http.post<FingerprintProfile>(`/api/fingerprint-profiles/${id}/regenerate`), onSuccess: inv })
  }
}
