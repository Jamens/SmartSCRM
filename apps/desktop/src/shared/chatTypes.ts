// src/shared/chatTypes.ts
import type { ChatPlatform } from './chatPlatform.ts'
import type { GroupEventWire, GroupParticipantWire } from './groupMembers.ts'

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
  /** 裸平台消息 id（WA: wa-js `id.id`；= 页内 `data-id`），与序列化的 `msgKey` 解耦，供译文按消息回显对齐。 */
  msgId?: string
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

/**
 * ack 推进用的"状态帧"：一次页内事件一帧，只带键与目标状态，不带正文/方向/来源。
 * 与 `LiveFrame` 分开是有原因的：`applyLiveFrame` 的合并是逐字段覆盖，把一帧只有状态的
 * 东西塞进 `NormalizedMessage`，就会把已有行的 body/direction 抹成 null。
 * 后端落库与页面显示都以这份为准，所以 `status` 只允许向上（`chatStatus.canAdvance`）。
 */
export interface StatusFrame {
  viewId: string
  accountId: number
  platform: ChatPlatform
  chatKey: string
  msgKeys: string[]
  status: MsgStatus
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
  /**
   * 这个视图正在看哪个会话（按 `activeChatKeyOf()` 裁过）；桥不在线、没选中会话、或页内报来即不成形 → null。
   * 与 `LiveFrame.activeChatKey` 同一个叫法、同一份来源（`msgBridge/index.ts` 的 `activeChat` map），不引入第二个名字。
   * 组装只发生在 `bridgeStates()` 一处，那是 `msg:state` 与 `msg:bridges` 的共同出口（spec §5 / D-04）。
   */
  activeChatKey: string | null
}

/**
 * `BridgeMount` 手里的那一半：它只有 phase/since/detail，`activeChat` 那张 map 在 index 里，
 * 必填字段会让 `bridgeMount.ts` 的 `state()` 直接编译不过。所以装配返回这一份，
 * `activeChatKey` 由 `bridgeStates()` 补齐——"只有一个组装口"这条要求仍然成立（P-08）。
 */
export type BridgeStateCore = Omit<BridgeState, 'activeChatKey'>

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

export interface RecallRequest {
  accountId: number
  chatKey: string
  msgKey: string
  localId: string
}

export interface RecallReceipt {
  localId: string
  ok: boolean
  /** 只有页内返回体 isRevoked===true 才是 true（spec §6 的判定）。 */
  isRevoked?: boolean
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
  | { kind: 'recall_result'; localId: string; ok: boolean; isRevoked?: boolean; detail?: string }
  /**
   * 一次页内 ack 事件一帧：wa-js 的回执事件本来就带着 `ids[]`（整群读回执一次给几十条），
   * 拆成一 id 一帧会把一次更新变成几十个并发请求，而落库那侧每个请求是一个带行锁的事务。
   */
  | { kind: 'ack'; chatKey: string; msgKeys: string[]; status: MsgStatus }
  | { kind: 'active_chat'; chatKey: string | null }
  | { kind: 'logged_out' }
  // ---- B6 群成员：三条只读通道。都是"桥看见了什么"，不含任何账号归属判断。 ----
  /** `group_list` 的回执。失败时 groups 不带，主进程记一条缺口而不是当成"这个账号没有群"。 */
  | {
      kind: 'group_list_result'
      reqId: string
      ok: boolean
      groups?: Array<{ chatKey: string; title: string | null }>
      error?: string
    }
  /**
   * `group_snapshot` 的回执。
   * `ok:false` 与"回一份空名单"是两件事：空名单会把整群人在覆盖率闸前送进 `is_in_group=0`，
   * 所以页内两方都取不到人时**必须**回 ok:false（见 shared/groupMembers.ts 的 snapshotIsUsable）。
   */
  | {
      kind: 'group_snapshot_result'
      reqId: string
      chatKey: string
      ok: boolean
      participants?: GroupParticipantWire[]
      /** 页内自报的人数（主源 + 副源并集的大小），用于与上次成功快照比覆盖率。 */
      participantCount?: number
      /** 页内怀疑自己被分页截断了；主进程据此记缺口，不拿它去判退。 */
      truncated?: boolean
      error?: string
    }
  /** 进退事件，随到随报，不等建档泵。一批一帧，避免一次群变动打出几十个请求。 */
  | { kind: 'group_event'; events: GroupEventWire[] }

/** 主 → 页，走既有的 `view:host:msg-cmd` 推送通道。 */
export type BridgeCommand =
  | { kind: 'ping' }
  | { kind: 'send'; localId: string; chatKey: string; text: string }
  | { kind: 'recall'; localId: string; chatKey: string; msgKey: string }
  | { kind: 'backfill'; limit: number }
  | { kind: 'open_chat'; chatKey: string }
  // ---- B6 群成员：两条只读命令。刻意不进 sendLock（采集不冒充发送方）。 ----
  /** 列出账号所在的群。只列，不点开任何会话。 */
  | { kind: 'group_list'; reqId: string }
  /** 拉一个群的成员名单。只读：不发消息、不改页面状态。 */
  | { kind: 'group_snapshot'; reqId: string; chatKey: string }

export interface BridgeInstallConfig {
  bridgeVersion: string
  platform: ChatPlatform
  viewId: string
  /** 补底每会话条数（spec §4 的 msgHistoryLimit）。 */
  historyLimit: number
}
