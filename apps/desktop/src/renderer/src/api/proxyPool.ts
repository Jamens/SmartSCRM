// src/renderer/src/api/proxyPool.ts
//
// B13 代理池渲染层出口：代理 CRUD + 模拟出口探测。端点接 A16 proxy:read/write（V40 播种）。
// 出口 IP 探测是后端确定性模拟（不发起真实外连，符合开源红线），前端只展示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type ProxyStatus = 'online' | 'offline' | 'error' | 'degraded'
export type ProxyProtocol = 'http' | 'https' | 'socks5'

export interface ProxyPool {
  id: number
  tenantId: number
  name: string
  host: string
  port: number
  protocol: ProxyProtocol
  username: string | null
  password: string | null
  status: ProxyStatus
  /** 上次（模拟）探测时间。 */
  lastCheckedAt: string | null
  /** 出口 IP（模拟探测结果）。 */
  egressIp: string | null
  /** 归属地（模拟探测结果，country · region · city）。 */
  egressGeo: string | null
  /** 延迟毫秒（模拟探测结果）。 */
  latencyMs: number | null
  remark: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ProxyPoolUpsert {
  name: string
  host: string
  port?: number | null
  protocol?: ProxyProtocol
  username?: string | null
  password?: string | null
  status?: ProxyStatus
  remark?: string | null
}

export function useProxyPool(): ReturnType<typeof useQuery<ProxyPool[], Error>> {
  return useQuery({
    queryKey: ['proxy-pool', 'list'],
    queryFn: () => http.get<ProxyPool[]>('/api/proxy-pool'),
    refetchInterval: 15_000
  })
}

export function useProxyPoolMutations(): {
  create: ReturnType<typeof useMutation<ProxyPool, Error, ProxyPoolUpsert, unknown>>
  update: ReturnType<typeof useMutation<ProxyPool, Error, { id: number; body: ProxyPoolUpsert }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
  test: ReturnType<typeof useMutation<ProxyPool, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => void qc.invalidateQueries({ queryKey: ['proxy-pool'] })
  return {
    create: useMutation({ mutationFn: (b) => http.post<ProxyPool>('/api/proxy-pool', b), onSuccess: inv }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<ProxyPool>(`/api/proxy-pool/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/proxy-pool/${id}`), onSuccess: inv }),
    // 模拟出口探测：写回探测结果，成功后刷新列表以展示 egressIp/geo/latency。
    test: useMutation({ mutationFn: (id) => http.post<ProxyPool>(`/api/proxy-pool/${id}/test`), onSuccess: inv })
  }
}
