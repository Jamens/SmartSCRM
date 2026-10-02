// src/renderer/src/services/protocol/manager.ts
// 每个 type-7（WA 协议号）账号起一个 ProtocolClient，把网关 WS 实时推送的
// 入站消息 / 状态帧，归一化后转发到现有后端入库面（/api/messages/batch、/api/messages/status）。
// 旧版 D:\electron-client 即此形态：渲染进程直连网关 -> 落库到统一入库面，不经 WebView。
//
// 设计要点：
// - 纯映射（payload -> DTO）放在 @shared/protocol/map.ts，本文件只做"接线 + 生命周期"。
// - ingest / applyStatus / getToken / onAuthFailure 全部注入，便于测试；client 创建也走 clientFactory 接缝。
//
// 关键约束（对齐旧版真实网关契约，2026-10-02 读码核到行级）：
// 状态推送 WA_MSG_STATUS_PUSH 只带 conversationId + messageId，**没有 chatKey**；
// 而入库面 /api/messages/status 需要 chatKey。因此本 manager 必须在收到入站消息时，
// 把 conversationId -> peerJid(=chatKey) 记下来，状态推送到达时反查 chatKey 再转发。

import { inboundMessageToBatch, statusPushToStatus } from '@shared/protocol/map.ts'
import type {
  IngestBatch,
  IngestStatus,
  ProtocolInboundMessage,
  ProtocolStatusPush
} from '@shared/protocol/types.ts'
import { ProtocolClient, type ProtocolClientOptions } from './client.ts'

export interface ProtocolSyncDeps {
  baseUrl: string
  wsUrl: string
  getToken: () => string | null
  /** 转发单条消息批量到 /api/messages/batch。 */
  ingest: (batch: IngestBatch) => Promise<unknown>
  /** 转发状态批量到 /api/messages/status。 */
  applyStatus: (status: IngestStatus) => Promise<unknown>
  /** 鉴权失败（4001–4004）时刷新 token；返回新 token 或 null。透传给 client.onAuthFailure。 */
  onAuthFailure?: () => Promise<string | null>
  /** 测试接缝：不传则用真实 ProtocolClient。 */
  clientFactory?: (
    opts: ProtocolClientOptions
  ) => Pick<ProtocolClient, 'connect' | 'disconnect' | 'isStopped'>
}

export class ProtocolSyncManager {
  private clients = new Map<number, ProtocolClient>()

  /**
   * conversationId -> chatKey(peerJid) 映射，按账号隔离。
   * 用于把"无 chatKey 的状态推送"反查到正确的 chatKey（见 handleStatus）。
   */
  private chatKeyByConversation = new Map<number, Map<number, string>>()

  constructor(private readonly deps: ProtocolSyncDeps) {}

  /**
   * 按账号集合校准运行中的 client：新增的起连接，消失的断开。
   * 已存在且未停的连接保持不动（避免账号列表变化引起 WS 抖动）。
   */
  start(accountIds: number[]): void {
    const wanted = new Set(accountIds)
    for (const id of [...this.clients.keys()]) {
      if (!wanted.has(id)) this.detach(id)
    }
    for (const id of accountIds) {
      const existing = this.clients.get(id)
      if (existing && !existing.isStopped()) continue
      this.attach(id)
    }
  }

  private attach(accountId: number): void {
    const client = this.makeClient(accountId)
    this.clients.set(accountId, client as ProtocolClient)
    client.connect()
  }

  private detach(accountId: number): void {
    this.clients.get(accountId)?.disconnect()
    this.clients.delete(accountId)
    this.chatKeyByConversation.delete(accountId)
  }

  private makeClient(accountId: number): ProtocolClient {
    const opts: ProtocolClientOptions = {
      baseUrl: this.deps.baseUrl,
      wsUrl: this.deps.wsUrl,
      getToken: this.deps.getToken,
      onInbound: (data: unknown) => void this.handleInbound(accountId, data),
      onStatus: (data: unknown) => void this.handleStatus(accountId, data),
      onAuthFailure: this.deps.onAuthFailure
    }
    return (
      this.deps.clientFactory
        ? (this.deps.clientFactory(opts) as unknown as ProtocolClient)
        : new ProtocolClient(opts)
    ) as ProtocolClient
  }

  private recordChatKey(
    accountId: number,
    conversationId: number | undefined,
    chatKey: string | undefined
  ): void {
    if (conversationId == null || !chatKey) return
    let m = this.chatKeyByConversation.get(accountId)
    if (!m) {
      m = new Map<number, string>()
      this.chatKeyByConversation.set(accountId, m)
    }
    m.set(conversationId, chatKey)
  }

  /** 数据驱动 handler：入站消息 payload 不带 chatKey 时，按 conversationId 反查。 */
  private lookupChatKey(accountId: number, conversationId: number | undefined): string | undefined {
    if (conversationId == null) return undefined
    return this.chatKeyByConversation.get(accountId)?.get(conversationId)
  }

  private async handleInbound(accountId: number, data: unknown): Promise<void> {
    const msg = data as ProtocolInboundMessage | null
    if (!msg) return
    // 先记下 conversationId -> peerJid，供后续状态推送反查 chatKey
    this.recordChatKey(accountId, msg.conversationId, msg.peerJid)
    const batch = inboundMessageToBatch(accountId, msg)
    if (!batch) return
    try {
      await this.deps.ingest(batch)
    } catch (e) {
      console.error('[protocol] inbound ingest failed', accountId, e)
    }
  }

  private async handleStatus(accountId: number, data: unknown): Promise<void> {
    const push = data as ProtocolStatusPush | null
    if (!push) return
    // 状态推送只有 conversationId + messageId，无 chatKey：反查映射
    const chatKey = this.lookupChatKey(accountId, push.conversationId)
    if (!chatKey) {
      // 边缘情况：状态推送早于首条入站消息到达，本会话尚无 chatKey 映射。
      // 无法定位 chatKey，安全丢弃（不入错会话）；后续由历史拉取补偿。
      console.warn(
        '[protocol] status push without chatKey mapping, dropped',
        accountId,
        push.conversationId,
        push.messageId
      )
      return
    }
    const status = statusPushToStatus(accountId, chatKey, push)
    if (!status) return
    try {
      await this.deps.applyStatus(status)
    } catch (e) {
      console.error('[protocol] status apply failed', accountId, e)
    }
  }

  /** 断开全部 client（登出 / 卸载时）。 */
  stop(): void {
    for (const id of [...this.clients.keys()]) this.detach(id)
  }
}
