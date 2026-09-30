// src/bridge/whatsapp/groups.ts
import type { BridgeReport } from '../../shared/chatTypes.ts'
import { peerPhoneOfChatKey } from '../../shared/chatKeys.ts'
import {
  classifyGroupSystemMessage,
  eventTypeFromAction,
  liveEventDedupKey,
  mergeParticipants,
  snapshotIsUsable,
  type GroupEventWire,
  type GroupParticipantWire,
  type GroupMemberRole
} from '../../shared/groupMembers.ts'
import type {
  WaChatModel,
  WaGroupParticipantChanged,
  WaMsgModel,
  WaParticipant,
  WppContactApi,
  WppGroupApi
} from '../types.ts'

/**
 * 群成员采集的页内实现（spec §4）。只做三件事：列群、拉成员名单、转译在线事件。
 *
 * 这个模块**只读**：不发消息、不改页面状态、不点任何会话。它需要的用户动作只有
 * "账号视图已挂载且已登录"。
 *
 * 页内只说得出"我看见了什么"，说不出"我属于哪个账号"——账号归属由主进程盖章，
 * 这里产出的每一帧都不带 accountId（沿用既有口径，不削弱）。
 */

/** 只声明本模块真正用到的那几个能力，测试给假对象即可（与 send.ts 吃 chat 对象同路子）。 */
export interface GroupsWpp {
  group?: WppGroupApi
  chat?: { get(chatId: string): WaChatModel | undefined }
  contact?: WppContactApi
  on(event: 'group.participant_changed', cb: (p: WaGroupParticipantChanged) => void): { off(): void }
}

export interface GroupListResult {
  ok: boolean
  groups?: Array<{ chatKey: string; title: string | null }>
  error?: string
}

export interface SnapshotResult {
  ok: boolean
  participants?: GroupParticipantWire[]
  participantCount?: number
  truncated?: boolean
  error?: string
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------
// 群名单
// ---------------------------------------------------------------------------

/**
 * 列出账号所在的群。`wpp` 允许为空——页内 `window.WPP` 还没挂上时（桥刚注入、
 * 页面还在加载）主进程就会来问，那时返回"不可用"比抛异常好：调用方按缺口记一条即可。
 *
 * `getAllGroups()` 的返回类型里带 `undefined`（wa-js 的声明就是联合 undefined），
 * 所以必须逐项过滤——不过滤会让一个空位变成 `chatKey: undefined` 进库。
 * 只收群键：非群键（单聊）进不了 `chat_group` 的业务语义。
 *
 * **待验证**（spec §15#2）：这个列表是否包含已退出群、归档群、社群下的子群。
 * 实测后可能要在建档时就给 `is_final` 打标，届时改这里。
 */
export async function listGroups(wpp: GroupsWpp | undefined): Promise<GroupListResult> {
  if (!wpp?.group?.getAllGroups) {
    return { ok: false, error: 'WPP.group 不可用' }
  }
  let all: Array<WaChatModel | undefined>
  try {
    all = await wpp.group.getAllGroups()
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
  const groups: Array<{ chatKey: string; title: string | null }> = []
  for (const c of all ?? []) {
    const key = c?.id?._serialized
    if (!key || !key.includes('@g.us')) {
      continue
    }
    groups.push({ chatKey: key, title: c?.formattedTitle ?? c?.name ?? null })
  }
  return { ok: true, groups }
}

// ---------------------------------------------------------------------------
// 成员快照
// ---------------------------------------------------------------------------

function roleOf(p: WaParticipant): GroupMemberRole {
  if (p?.isSuperAdmin) return 'super'
  if (p?.isAdmin) return 'admin'
  return 'member'
}

function wireOf(p: WaParticipant, wpp: GroupsWpp | undefined): GroupParticipantWire | null {
  const memberKey = p?.id?._serialized
  if (!memberKey) {
    return null
  }
  let displayName: string | null = null
  try {
    const c = wpp?.contact?.get(memberKey)
    displayName = c?.pushname ?? c?.name ?? c?.formattedName ?? null
  } catch {
    // 取不到就留空，不猜：一个编出来的名字比没有名字更难发现它是错的。
  }
  return {
    memberKey,
    phone: peerPhoneOfChatKey(memberKey),
    displayName,
    roleType: roleOf(p)
  }
}

/**
 * 副源：`WPP.chat.get(id).groupMetadata.participants`。
 * 同步调用且可能抛（群未加载、模型未就绪），所以整体包一层 try。
 */
function secondaryParticipants(wpp: GroupsWpp | undefined, chatKey: string): GroupParticipantWire[] {
  try {
    const chat = wpp?.chat?.get(chatKey)
    const raw = chat?.groupMetadata?.participants
    if (!raw) {
      return []
    }
    const out: GroupParticipantWire[] = []
    for (const p of raw) {
      const w = wireOf(p, wpp)
      if (w) {
        out.push(w)
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * 拉一个群的成员名单。
 *
 * 主源 `WPP.group.getParticipants`，副源 `groupMetadata.participants`，两者按 memberKey 取**并集**
 * （副源给不出进群时间，但能补上主源漏掉的人，所以是并集不是择优）。
 *
 * **两方都空一律回 ok:false**（spec §4）：把空名单当成功快照送进 reconcile，
 * 会在覆盖率闸前把整群人判成 `is_in_group=0`——一次拉取失败就抹掉一整个群。
 * 宁可记一条缺口，也不要这个后果。
 */
export async function snapshotGroup(wpp: GroupsWpp | undefined, chatKey: string): Promise<SnapshotResult> {
  if (!wpp?.group?.getParticipants) {
    return { ok: false, error: 'WPP.group 不可用' }
  }
  let primaryRaw: WaParticipant[]
  try {
    primaryRaw = await wpp.group.getParticipants(chatKey)
  } catch (e) {
    // 主源失败不直接判死：副源可能还拿得到。两个都空才在下面判失败。
    primaryRaw = []
    if (!secondaryParticipants(wpp, chatKey).length) {
      return { ok: false, error: errText(e) }
    }
  }
  const primary: GroupParticipantWire[] = []
  for (const p of primaryRaw ?? []) {
    const w = wireOf(p, wpp)
    if (w) {
      primary.push(w)
    }
  }
  const secondary = secondaryParticipants(wpp, chatKey)
  const merged = mergeParticipants(primary, secondary)
  if (!snapshotIsUsable(merged)) {
    return { ok: false, error: '两个来源都没取到成员（空名单不能当成功快照）' }
  }
  // truncated 刻意不写：页内没有可靠手段判断自己被分页截断了
  // （spec §15#3 待实测）。写 false 等于撒一个"我确定没截断"的谎。
  return { ok: true, participants: merged, participantCount: merged.length }
}

// ---------------------------------------------------------------------------
// 系统消息旁路（spec §4）
// ---------------------------------------------------------------------------

/**
 * 从一条群系统消息里解析出进退事件。这是与"在线事件订阅"并列的**第二条腿**：
 * 在线事件只覆盖页面在线时段，离线时段的变更只能靠解析系统消息补。
 *
 * 用 `msgKey` 做去重键：同一条系统消息补底重跑、live 与 backfill 交叠，都靠它消解
 * （后端 `uk_event` 含 dedup_key，重复插入直接忽略且不重复投影）。
 *
 * 已知代价（spec §4）：桥早期版本没取 subtype，已经落库的历史消息行补不回事件；
 * 只有重跑补底才能把那批人的进退史填进来，而重跑不会重复消息行（`uk_msg` 幂等）。
 */
export function systemEventsFromRaw(
  raw: WaMsgModel,
  chatKey: string,
  msgKey: string,
  nowEpochSec: number
): GroupEventWire[] {
  const hit = classifyGroupSystemMessage({
    type: raw?.type ?? null,
    subtype: raw?.subtype ?? null,
    participants: raw?.participants,
    participantIds: raw?.participantIds,
    recipients: raw?.recipients,
    author: raw?.author ?? raw?.from ?? null,
    sender: raw?.from ?? null,
    participant: raw?.participant ?? raw?.recipient ?? null,
    chatKey
  })
  if (!hit || hit.targets.length === 0) {
    return []
  }
  // 系统消息自带时间，用消息时间而不是"观测时刻"；后端 MsgTimes 会钳不合理值。
  const occurredAt = typeof raw?.t === 'number' && raw.t > 0 ? raw.t : nowEpochSec
  return hit.targets.map((memberKey) => ({
    chatKey,
    memberKey,
    actorKey: hit.actorKey,
    actorName: null,
    eventType: hit.eventType,
    occurredAtEpochSec: occurredAt,
    dedupKey: `${msgKey}#${memberKey}`,
    source: 'system_message',
    rawType: raw?.type ?? null,
    rawSubtype: raw?.subtype ?? null,
    bodySnapshot: clipText(raw?.body, 512)
  }))
}

function clipText(s: string | undefined, max: number): string | null {
  if (!s) {
    return null
  }
  return s.length <= max ? s : s.substring(0, max)
}

// ---------------------------------------------------------------------------
// 在线事件订阅
// ---------------------------------------------------------------------------

/** `participant_changed` → 一批事件线框。导出以便单测直接打。 */
export function toGroupEventWires(p: WaGroupParticipantChanged, nowEpochSec: number): GroupEventWire[] {
  const eventType = eventTypeFromAction(p?.action)
  if (!eventType) {
    return []
  }
  const targets = (p.participants ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (targets.length === 0) {
    // 没有目标人就不产事件：不知道是谁，就不造一条指向不明的流水。
    return []
  }
  const actorKey = p.author ?? null
  const dedupKey = liveEventDedupKey(actorKey, nowEpochSec, p.action)
  return targets.map((memberKey) => ({
    chatKey: p.groupId,
    memberKey,
    actorKey,
    actorName: p.authorPushName ?? null,
    eventType,
    // 这个事件**不带发生时间**，只能是观测时刻（spec §15#5）。
    occurredAtEpochSec: nowEpochSec,
    dedupKey,
    source: 'live_event',
    rawType: p.action,
    rawSubtype: p.operation == null ? null : String(p.operation),
    bodySnapshot: null
  }))
}

/**
 * 订阅群成员变动，返回取消订阅的函数。
 *
 * 订阅失败（wa-js 没这个事件、签名变了）**不抛**：页内能力缺失不该让整条桥挂掉，
 * 主进程那边由建档泵的空名单缺口兜住。
 * `off()` 包 try 是因为真实页面里热更新后 `off()` 会抛
 * "removeListener only takes instances of Function"（2026-09-22 实测，见 index.ts destroy 注释）。
 */
export function subscribeGroupEvents(wpp: GroupsWpp | undefined, emit: (r: BridgeReport) => void): () => void {
  if (!wpp?.on) {
    return () => {}
  }
  let sub: { off(): void } | null = null
  try {
    sub = wpp.on('group.participant_changed', (p) => {
      const events = toGroupEventWires(p, Math.floor(Date.now() / 1000))
      if (events.length > 0) {
        emit({ kind: 'group_event', events })
      }
    })
  } catch {
    return () => {}
  }
  return () => {
    try {
      sub?.off()
    } catch {
      /* 忽略：见上面的实测说明 */
    }
  }
}
