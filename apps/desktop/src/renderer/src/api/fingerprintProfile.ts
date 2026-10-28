// src/renderer/src/api/fingerprintProfile.ts
//
// B14 浏览器指纹配置渲染层出口：指纹档案 CRUD + 模拟生成 + 账号绑定。端点接 A16 fingerprint:read/write（V42 播种）。
// 生成指纹是后端确定性模拟（不探测真实设备），前端只展示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { FingerprintRuntime } from '@shared/fingerprint'

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

/**
 * 账号 ↔ 档案绑定。`profileId` 传 `null` = 解绑（后端 `PATCH` 的语义；`DELETE` 是同一个出口的另一条路）。
 *
 * 这里只发"绑定到哪一份"，不发任何指纹参数——参数怎么拼是主进程的事（spec R10）。
 */
export function bindProfile(accountId: number, profileId: number | null): Promise<void> {
  return http.patch<void>(`/api/platform-accounts/${accountId}/fingerprint`, { profileId })
}

/**
 * 账号当前这份档案**已解析**的运行时参数。未绑定时后端回 `data: null`。
 *
 * 与 `bindProfile` 同一条规矩（R10）：渲染层只读它，不解析、不拼装、不按字段改行为——
 * 哪一项生效、缺哪一项不改，都是主进程的判定。
 */
export function fingerprintRuntime(accountId: number): Promise<FingerprintRuntime | null> {
  return http.get<FingerprintRuntime | null>(`/api/platform-accounts/${accountId}/fingerprint-runtime`)
}

/** 绑定/解绑：成功后刷账号列表——卡片上那个下拉读的就是列表里的 `fingerprintProfileId`。 */
export function useBindAccountFingerprint(): ReturnType<typeof useMutation<void, Error, { accountId: number; profileId: number | null }, unknown>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, profileId }) => bindProfile(accountId, profileId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-accounts'] })
  })
}
