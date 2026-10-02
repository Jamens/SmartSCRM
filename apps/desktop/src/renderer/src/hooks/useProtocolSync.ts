// src/renderer/src/hooks/useProtocolSync.ts
// 登录态下，为所有 type-7（WA 协议号）账号建立网关同步；登出或卸载时清理。
// 与网页 WA 的"注入 + WebView 桥"完全独立——协议号走独立的 REST/WS 通道（旧版直连形态）。

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { http } from '@/lib/http'
import type { PlatformAccount } from '@/stores/accounts'
import { ProtocolSyncManager, setActiveProtocolManager } from '@/services/protocol/manager'
import { PROTOCOL_URL, PROTOCOL_WS_URL } from '@/services/protocol/config'
import type { IngestBatch, IngestStatus } from '@shared/protocol/types.ts'

// 与 useAccounts 共用同一 query key，命中同一份缓存，避免重复拉取。
const PLATFORM_ACCOUNTS_KEY = ['platform-accounts'] as const

/** 无 type-7 账号时返回空数组，manager 自然空转。 */
function protocolAccountIds(accounts: PlatformAccount[] | undefined): number[] {
  if (!accounts) return []
  return accounts.filter((a) => a.platformType === 7).map((a) => a.id)
}

export function useProtocolSync(): void {
  const phase = useAuthStore((s) => s.phase)
  const { data: accounts } = useQuery<PlatformAccount[]>({
    queryKey: PLATFORM_ACCOUNTS_KEY,
    queryFn: () => http.get<PlatformAccount[]>('/api/platform-accounts'),
    enabled: phase === 'authenticated'
  })

  const mgrRef = useRef<ProtocolSyncManager | null>(null)

  useEffect(() => {
    // manager 只创建一次（惰性），闭包里的 http / getToken 都是稳定引用。
    if (!mgrRef.current) {
      mgrRef.current = new ProtocolSyncManager({
        baseUrl: PROTOCOL_URL,
        wsUrl: PROTOCOL_WS_URL,
        getToken: () => useAuthStore.getState().accessToken,
        ingest: (batch: IngestBatch) => http.post('/api/messages/batch', batch),
        applyStatus: (status: IngestStatus) => http.post('/api/messages/status', status),
        // WS 鉴权失败（4001–4004）时由 auth store 刷新 accessToken 后续连
        onAuthFailure: () => useAuthStore.getState().refresh()
      })
      // 登记活跃实例，供渲染层出站发送分流（sendViaProtocol）复用同一 manager。
      setActiveProtocolManager(mgrRef.current)
    }
    const mgr = mgrRef.current
    if (phase !== 'authenticated' || !accounts) {
      mgr.stop()
      return
    }
    mgr.start(protocolAccountIds(accounts))
  }, [phase, accounts])

  useEffect(() => {
    return () => {
      setActiveProtocolManager(null)
      mgrRef.current?.stop()
    }
  }, [])
}
