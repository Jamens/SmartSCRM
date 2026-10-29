// src/renderer/src/hooks/useProtocolSync.ts
// 登录态下，为所有外部协议源账号建立网关同步；登出或卸载时清理。
// 与网页 WA 的「注入 + WebView 桥」完全独立——协议源走自己的 REST/WS 通道，渲染进程直连。
//
// 当前覆盖两个源：type-7 = WA 协议号（B27），type-8 = TG 协议源（MTProto，期一）。
// 期一定位：**当前版本下没有 type-8 账号**（建号流程属于期二 §4-Q2），所以 protocolEntries
// 现在只会吐出 wa-protocol 条目，TG 分支在真机上不会命中——TG 多源通路**只由离线 harness
// （test/telegram-protocol）覆盖**。这是期一既定的覆盖范围，不是漏接线。

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { http } from '@/lib/http'
import type { PlatformAccount } from '@/stores/accounts'
import { ProtocolSyncManager, setActiveProtocolManager } from '@/services/protocol/manager'
import {
  PROTOCOL_URL,
  PROTOCOL_WS_URL,
  TG_PROTOCOL_URL,
  TG_PROTOCOL_WS_URL
} from '@/services/protocol/config'
import type { IngestBatch, IngestStatus, ProtocolSourceEntry } from '@shared/protocol/types.ts'
import {
  TELEGRAM_PROTOCOL_ACCOUNT_TYPE,
  WHATSAPP_PROTOCOL_ACCOUNT_TYPE
} from '@shared/chatPlatform.ts'

// 与 useAccounts 共用同一 query key，命中同一份缓存，避免重复拉取。
const PLATFORM_ACCOUNTS_KEY = ['platform-accounts'] as const

/**
 * 账号 platformType -> 协议源：7 = WA 协议号（B27），8 = TG 协议源（MTProto）。
 * 其余平台类型（含网页版 WA / TG）不走这条链，返回空数组让 manager 自然空转。
 */
const SOURCE_BY_PLATFORM_TYPE: Record<number, ProtocolSourceEntry['source']> = {
  [WHATSAPP_PROTOCOL_ACCOUNT_TYPE]: 'wa-protocol',
  [TELEGRAM_PROTOCOL_ACCOUNT_TYPE]: 'telegram'
}

/** 无协议源账号时返回空数组，manager 自然空转。 */
function protocolEntries(accounts: PlatformAccount[] | undefined): ProtocolSourceEntry[] {
  if (!accounts) return []
  return accounts.flatMap((a) => {
    const source = SOURCE_BY_PLATFORM_TYPE[a.platformType]
    return source ? [{ accountId: a.id, source }] : []
  })
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
        // TG 源地址未配置时为 ''：TG 源静默，不向任何外部服务发起连接
        tgBaseUrl: TG_PROTOCOL_URL,
        tgWsUrl: TG_PROTOCOL_WS_URL,
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
    mgr.start(protocolEntries(accounts))
  }, [phase, accounts])

  useEffect(() => {
    return () => {
      setActiveProtocolManager(null)
      mgrRef.current?.stop()
    }
  }, [])
}
