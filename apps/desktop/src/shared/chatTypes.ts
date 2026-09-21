// src/shared/chatTypes.ts
import type { ChatPlatform } from './chatPlatform.ts'

export type Direction = 'in' | 'out'
/** `received` 只属于 in；out 用后五个。 */
export type MsgStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
export type MsgSource = 'live' | 'backfill' | 'app_send' | 'native_send'
export type MediaType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'unknown'

export const MEDIA_TYPES: readonly MediaType[] = [
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'contact', 'location', 'unknown'
]

/** 桥归一化产出的原子单位；字段名与后端 `MessageItemDTO` 逐字一致，主进程不做改名直传。 */
export interface NormalizedMessage {
  chatKey: string
  msgKey: string
  direction: Direction
  senderKey?: string
  senderName?: string
  body?: string | null
  mediaType: MediaType
  mediaSummary?: string | null
  /** 平台原始秒值，交给 Java 换算（收敛 #9）。 */
  msgTimeEpochSec: number
  status: MsgStatus
  source: MsgSource
  sendLocalId?: string
  chatTitle?: string
}

/** 主进程广播给渲染层的一帧：入库用的 message + 判断未读数要的活动会话。 */
export interface LiveFrame {
  viewId: string
  accountId: number
  platform: ChatPlatform
  activeChatKey: string | null
  message: NormalizedMessage
}

export type BridgePhase = 'none' | 'mounting' | 'ready' | 'retry' | 'offline' | 'destroyed'

export interface BridgeState {
  viewId: string
  accountId: number | null
  platform: ChatPlatform | null
  phase: BridgePhase
  ready: boolean
  /** 进入当前 phase 的时刻（epoch ms），UI 用来显示"上次心跳"。 */
  since: number
  detail: string | null
}

export interface SendRequest {
  accountId: number
  chatKey: string
  text: string
  localId: string
}

export type SendError = 'BRIDGE_OFFLINE' | 'SEND_FAILED' | 'CHAT_NOT_FOUND' | 'TIMEOUT'

export interface SendReceipt {
  localId: string
  ok: boolean
  msgKey?: string
  error?: SendError
  detail?: string
}

/** 页 → 主。全部经 `window.ele.sendToHost('msg-report', report)`，不带任何凭据（C2）。 */
export type BridgeReport =
  | { kind: 'ready'; bridgeVersion: string }
  | { kind: 'pong'; bridgeVersion: string }
  | { kind: 'message'; message: NormalizedMessage }
  | { kind: 'backfill_progress'; chatsDone: number; chatsTotal: number; messages: number }
  | { kind: 'backfill_gap'; chatKey: string; reason: string }
  | { kind: 'send_result'; localId: string; ok: boolean; msgKey?: string; error?: SendError; detail?: string }
  | { kind: 'ack'; chatKey: string; msgKey: string; status: MsgStatus }
  | { kind: 'active_chat'; chatKey: string | null }
  | { kind: 'logged_out' }

/** 主 → 页，走既有的 `view:host:msg-cmd` 推送通道。 */
export type BridgeCommand =
  | { kind: 'ping' }
  | { kind: 'send'; localId: string; chatKey: string; text: string }
  | { kind: 'backfill'; limit: number }
  | { kind: 'open_chat'; chatKey: string }

export interface BridgeInstallConfig {
  bridgeVersion: string
  platform: ChatPlatform
  viewId: string
  /** 补底每会话条数（spec §4 的 msgHistoryLimit）。 */
  historyLimit: number
}
