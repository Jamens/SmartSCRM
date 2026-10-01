/**
 * P8 / B6 群成员分析的纯规则与线上契约。
 *
 * 放 `shared/` 是因为它跨三个进程边界：桥（采集与事件订阅）、主进程（建档泵与导出）、
 * 渲染层（名单与流水的显示口径）都要按同一套规则理解同一条成员/事件，
 * 任何一侧自己实现一遍就会出现"桥说 removed、界面显示已退群但库里 latest_leave_at 为空"这类错位。
 *
 * 本文只描述本项目的规则。字段命名与序列化只在这一处定，两侧都从它取型。
 */

/** 成员角色。快照里 `ParticipantModel` 只给得出 `isAdmin`/`isSuperAdmin`，别的都推不出来。 */
export type GroupMemberRole = 'member' | 'admin' | 'super'

/** 进退事件类型。`added`/`joined` 的区别是"被别人加进来"与"自己进来的"，不是同一件事的两种写法。 */
export type GroupEventType = 'added' | 'joined' | 'left' | 'removed' | 'promoted' | 'demoted'

/** 事件来源。两个来源都要收：在线事件覆盖"页面在线时"，系统消息能补上离线时段的变更。 */
export type GroupEventSource = 'system_message' | 'live_event'

/** 快照里的一个成员（桥 → 主进程）。 */
export interface GroupParticipantWire {
  memberKey: string
  phone: string | null
  displayName: string | null
  roleType: GroupMemberRole
}

/** 一条进退事件（桥 → 主进程）。 */
export interface GroupEventWire {
  chatKey: string
  memberKey: string
  actorKey?: string | null
  actorName?: string | null
  eventType: GroupEventType
  occurredAtEpochSec: number
  dedupKey: string
  source: GroupEventSource
  rawType?: string | null
  rawSubtype?: string | null
  bodySnapshot?: string | null
}

// ---------------------------------------------------------------------------
// 常量（spec §5 / §6 / §10；泵与测试引用同一份，不许各写一份数字）
// ---------------------------------------------------------------------------

/** 同一账号内两个群之间的间隔：给页面留喘息，别把第三方站点当接口打。 */
export const GROUP_GAP_MS = 600
/** 单群快照超时。超时按失败处理并重试一次，绝不把超时当成"这个群没人"。 */
export const SNAPSHOT_TIMEOUT_MS = 15_000
export const RETRY_BACKOFF_MS = 2_000
/** 一轮建档最多处理多少个群。跑不完的留给下一轮，不做到点定时器。 */
export const MAX_GROUPS_PER_BUILD = 200

/**
 * 覆盖率闸（spec §2#3 / §6）：本次快照人数 / 上次成功快照人数，低于它就**不做**退群判定。
 * 只防单次截断误伤——连续两次都截断会一致地错，本期不解决，只保证 `coverage` 与 `reason` 在响应里可见。
 */
export const COVERAGE_MIN = 0.6

/** 一次导出最多多少个群（spec §10；超出即 400，界面按所选数量提前拦住）。 */
export const MAX_EXPORT_GROUPS = 50

/** 导出的 14 列。列序钉死，不含"地区"（没有数据来源，硬填只会造出一列空值）。 */
export const EXPORT_COLUMNS = [
  '序号',
  '群组名称',
  '群Id',
  '手机号',
  '名称',
  '角色',
  '是否在群',
  '进群时间',
  '进群数',
  '退群时间',
  '退出方式',
  '最近聊天时间',
  '当日发言数',
  '发言数'
] as const

// ---------------------------------------------------------------------------
// 在线事件：wa-js action → 本项目的 event_type
// ---------------------------------------------------------------------------

/**
 * wa-js `group.participant_changed` 的 action 映射（spec §4）。
 * `leaver` 按 `left` 收——wa-js 把"自己退群"与"被踢"分开报，落到我们这里都是不在群里了，
 * 但操作人不同（自己 vs 别人），`actor_key` 会带着这个区别进流水。
 */
const ACTION_TO_EVENT_TYPE: Record<string, GroupEventType> = {
  add: 'added',
  join: 'joined',
  remove: 'removed',
  leave: 'left',
  leaver: 'left',
  demote: 'demoted',
  promote: 'promoted'
}

export function eventTypeFromAction(action: string | undefined | null): GroupEventType | null {
  if (!action) return null
  return ACTION_TO_EVENT_TYPE[action] ?? null
}

/**
 * 在线事件的去重键：`actor|epochSec|action`（spec §3）。
 *
 * 这个事件**不带真实发生时间**，`epochSec` 是观测时刻（spec §15#5），所以合成键锚定的是
 * "我们什么时候看见它"而非"它什么时候发生"。去重仍然成立：同一条事件对同一观察者只会被包一次，
 * 键是稳定的。真机实测出偏差量级后可能要在界面标注"时间为观测时刻"，但那不动这个键。
 */
export function liveEventDedupKey(actorKey: string | null | undefined, epochSec: number, action: string): string {
  return `${actorKey ?? '-'}|${epochSec}|${action}`
}

// ---------------------------------------------------------------------------
// 系统消息：判定这一条是不是"加减人"，是的话出目标人
// ---------------------------------------------------------------------------

/** 分类器要读的那几个原始字段。刻意只声明用到的部分：`WaMsgModel` 很大，且这三族字段形态待实测。 */
export interface GroupSystemRaw {
  type?: string | null
  subtype?: string | null
  /** 目标人。三族字段在不同版本里出现在不同位置，所以都看一眼。 */
  participants?: unknown
  participantIds?: unknown
  recipients?: unknown
  /** 操作人。 */
  author?: unknown
  sender?: unknown
  participant?: unknown
  /** 群自身的 id，用来把"群"从目标人里剔掉。 */
  chatKey?: string | null
}

export interface GroupSystemClassification {
  eventType: GroupEventType
  /** 目标人的 memberKey 列表，已去重、已剔除群自身。 */
  targets: string[]
  actorKey: string | null
}

/** 这三族 type 才可能是群变动；`gp2` 同时承载群设置变更，所以还得看 subtype 才能定。 */
const GROUP_SYSTEM_TYPES = new Set(['gp2', 'group_notification', 'notification_template'])

/**
 * 群设置类变更：命中就不进流水（spec §4）。
 * 改名/描述/头像/消息模式都不是人的进退，把它们记成事件会让流水里混进一堆无法回答"谁进谁出"的噪声。
 */
const SETTING_SUBTYPE_RE =
  /subject|description|picture|announcement|messages?_?policy|allow|locked|unlocked|created|create|restrict/i

/**
 * 判定一条系统消息是不是"加减人"，是则返回事件类型与目标人，否则返回 null。
 *
 * 判定取自旧版已跑通过的那套正则族（`gp2` / `group_notification` + subtype 正则），
 * 不是新写的猜测；`promoted`/`demoted` 两族旧版没有（它只有 join/leave/remove 三态），
 * 这里按同一思路补上。
 *
 * `added` 与 `joined` 的区分是**本次的判断**，不是旧版行为：subtype 里出现 add/invite 说明有加人动作，
 * 出现 join 说明是自己进来。旧版把两族一律记成 join，是因为它只有三态。
 * 真机样本到手后要回来核（spec §15#1），不一致就改这里与单测夹具，不要改调用方去迁就。
 */
export function classifyGroupSystemMessage(raw: GroupSystemRaw): GroupSystemClassification | null {
  const type = norm(raw.type)
  const subtype = norm(raw.subtype)
  const haystack = [subtype, type].filter(Boolean).join('|')

  const isCandidate =
    GROUP_SYSTEM_TYPES.has(type) ||
    /add|invite|join|leave|remove|kick|promote|demote/.test(subtype) ||
    /add|invite|join|leave|remove|kick|promote|demote/.test(type)
  if (!isCandidate) return null
  if (SETTING_SUBTYPE_RE.test(subtype)) return null

  let eventType: GroupEventType
  if (/demote/i.test(haystack)) eventType = 'demoted'
  else if (/promote/i.test(haystack)) eventType = 'promoted'
  else if (/remove|removed|kick|kicked/i.test(haystack)) eventType = 'removed'
  else if (/leave|left|exit/i.test(haystack)) eventType = 'left'
  else if (/join|joined/i.test(haystack)) eventType = 'joined'
  else if (/add|added|invite|invited/i.test(haystack)) eventType = 'added'
  else return null

  const actorKey = pickFirstWid([raw.author, raw.sender, raw.participant])
  const targets = collectTargets(raw)

  // "退群"没有目标人字段时，退的那个人就是操作人自己——这一条旧版也是这么兜的。
  if (targets.length === 0) {
    if ((eventType === 'left' || eventType === 'removed') && actorKey && !isSameKey(actorKey, raw.chatKey)) {
      return { eventType, targets: [actorKey], actorKey }
    }
    return null
  }

  return { eventType, targets, actorKey }
}

// ---------------------------------------------------------------------------
// 快照：并集与"能不能算成功"
// ---------------------------------------------------------------------------

/**
 * 把主副两个来源按 `memberKey` 取并集（spec §4）。
 * 主源先填，副源只补主源没有的人——副源（`groupMetadata`）不含进群时间，
 * 但能补上主源漏掉的人，所以是并集不是择优。
 */
export function mergeParticipants(
  primary: readonly GroupParticipantWire[] | null | undefined,
  secondary: readonly GroupParticipantWire[] | null | undefined
): GroupParticipantWire[] {
  const out: GroupParticipantWire[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    for (const p of list ?? []) {
      if (!p?.memberKey || seen.has(p.memberKey)) continue
      seen.add(p.memberKey)
      out.push(p)
    }
  }
  return out
}

/**
 * 这一份快照能不能算"成功"。
 *
 * **空名单不算成功**（spec §4）：把空名单当成功快照送进 reconcile，会在覆盖率闸前把整群人
 * 判成 `is_in_group=0`，一次拉取失败就抹掉一整个群。宁可记一条失败缺口，也不要这个后果。
 */
export function snapshotIsUsable(participants: readonly GroupParticipantWire[]): boolean {
  return participants.length > 0
}

// ---------------------------------------------------------------------------
// 覆盖率闸（spec §6）
// ---------------------------------------------------------------------------

/**
 * `no_snapshot` 是第四种：这一批没带快照（只报事件，或快照是空名单被判不可用）。
 * 它意味着"本次根本没做在场性判定"，与 `coverage_too_low`（做了但被闸拦下）不是一回事，
 * 界面不该把两者显示成同一句话。
 */
export type CoverageReason = 'ok' | 'first_build' | 'coverage_too_low' | 'no_snapshot'

export interface CoverageVerdict {
  /** 本次是否做退群判定。 */
  reconciled: boolean
  /** 本次人数 / 上次成功快照人数；首次建档为 null（没有分母可除）。 */
  coverage: number | null
  reason: CoverageReason
}

/**
 * 覆盖率闸的判定。
 *
 * `prev` 传 null 或 0 都算首次建档——分母**只被成功快照覆盖**（spec §6 陷阱①），
 * 所以 0 与"从没建过档"在数据上是同一件事，不能拿它去除。
 */
export function snapshotCoverage(prevCount: number | null | undefined, curCount: number): CoverageVerdict {
  const firstBuild = prevCount == null || prevCount <= 0
  if (firstBuild) return { reconciled: true, coverage: null, reason: 'first_build' }

  const coverage = curCount / prevCount
  const allowed = coverage >= COVERAGE_MIN
  return {
    reconciled: allowed,
    coverage,
    reason: allowed ? 'ok' : 'coverage_too_low'
  }
}

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

function norm(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase() : ''
}

/** 从 participantIds / participants / recipients 等字段里掏出 wid 字符串数组。 */
function flattenWids(value: unknown): string[] {
  if (!value) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flattenWids)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // wa-js 的 Wid 对象常见形态：`{ _serialized: '8613xxx@c.us' }`，也可能嵌套在 `wid`/`id` 下。
    for (const key of ['_serialized', 'wid', 'id', 'user']) {
      const inner = obj[key]
      if (typeof inner === 'string') return [inner]
      if (inner && typeof inner === 'object') {
        const nested = flattenWids(inner)
        if (nested.length) return nested
      }
    }
  }
  return []
}

function pickFirstWid(values: readonly unknown[]): string | null {
  for (const v of values) {
    const wids = flattenWids(v)
    if (wids.length) return wids[0]
  }
  return null
}

function collectTargets(raw: GroupSystemRaw): string[] {
  const found: string[] = []
  for (const field of [raw.participants, raw.participantIds, raw.recipients]) {
    found.push(...flattenWids(field))
  }
  const dedup: string[] = []
  for (const w of found) {
    // 群自身不算目标人：系统消息里 recipients 有时把群 id 也带进来。
    if (!w || isSameKey(w, raw.chatKey)) continue
    if (dedup.includes(w)) continue
    dedup.push(w)
  }
  return dedup
}

function isSameKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a === b
}

// ---------------------------------------------------------------------------
// 建档结论与广播（主进程 → 渲染层；经 preload，所以必须活在 shared）
// ---------------------------------------------------------------------------

/**
 * 一轮建档的结论。放在 shared 而不是 `engine.ts`：`window.scrm.group.build` 的返回类型
 * 要经 preload，而 preload 不许 import `main/services/**`（与 `batchSend.ts` 的
 * `BatchProgress` 同一条边界理由）。
 * `skipped` 与 `list` 是两种「什么都没做」：前者这一账号不该做（在跑 / 没绑视图），
 * 后者做了但页内没给答案。渲染层的文案必须分开，混成一句就看不出该重试还是该等。
 *
 * `skippedFinal` 是"因 `is_final` 跳过的群数"。桥的 `group_list_result` 目前不带 `is_final`
 * （`bridge/whatsapp/groups.ts` 注明是后续），所以当下它恒为 0——这是"因这个原因跳过了 0 个"
 * 的真值，不是占位。
 */
export interface GroupBuildOutcome {
  accountId: number
  skipped: 'busy' | 'no_view' | null
  list: 'ok' | 'error' | 'silent'
  registered: number
  attempted: number
  snapshotted: number
  postedFailed: number
  failed: number
  skippedFinal: number
  truncated: boolean
  aborted: boolean
}

/** `group:state` 的唯一载荷：只说"这一轮在跑 / 结了"，进度另有真值。 */
export interface GroupStateEvent {
  accountId: number
  phase: 'running' | 'settled'
  outcome: GroupBuildOutcome | null
}

/**
 * 页内来的文本进主进程日志前收成一行：留着换行等于允许伪造日志行，长度也不该无界。
 * 与 msgBridge 那份同口径，唯一区别是它在这里是共享的：engine 与 host 都要用，
 * 两处各写一份就是两份要各自改的规矩。
 */
export function oneLine(text: string | undefined, max = 200): string {
  // \v \f 之类也算换行（Chrome 的 console 会把它们断行），所以按 C0 控制字符整体收。
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max)
}

// ---------------------------------------------------------------------------
// 导出结论
// ---------------------------------------------------------------------------

/** 导出结论六选一，界面按它给文案。`saved` 之外 `path` 一定是 null。 */
export type GroupExportReason = 'cancel' | 'empty_keys' | 'too_many' | 'no_rows' | 'failed' | 'saved'

export interface GroupExportResult {
  reason: GroupExportReason
  path: string | null
  rows: number
  bytes: number
}

// ---------------------------------------------------------------------------
// 中文标签与时刻文本（R46：这两张表与"去 T 截秒"各只有一份作者）
// ---------------------------------------------------------------------------

/**
 * 角色与退出方式的中文词只在这里有一份：表格里叫「群主」而界面上叫「超管」
 * 是同一事实写了两个词的结果。未知取值回落原词（平台以后加新角色时导出不许留空白）。
 */
const GROUP_ROLE_LABEL: Record<string, string> = { member: '成员', admin: '管理员', super: '群主' }
const EXIT_METHOD_LABEL: Record<string, string> = {
  removed: '被移出',
  left: '自行退群',
  invited_join: '受邀加入',
  added: '被加入',
  join: '主动加入',
  snapshot_absent: '快照中已不在'
}

export function groupRoleLabel(role: string | null): string {
  if (role === null) return '—'
  return GROUP_ROLE_LABEL[role] ?? role
}

export function exitMethodLabel(method: string | null): string {
  if (method === null) return '—'
  return EXIT_METHOD_LABEL[method] ?? method
}

/**
 * 群成员这一路的所有时刻都是后端 `LocalDateTime` 序列化出来的墙钟串（不带 `Z`）。
 * 「`T` 换空格、截到秒」这一手**只有这一处作者**：导出表格（`export.ts`）与渲染层名单
 * （`renderer/src/lib/groupDisplay.ts`）都 import 它。两处各写一遍，就会出现"文件里到秒、
 * 界面里到毫秒"这种同一个读数两个样子的错——而它只会在这两个界面并排看时被发现的。
 * 不用 `new Date(s)`：JS 会把不带偏移的串按本地时区读，于是同一行在两台机器上显示两个时刻。
 */
export function formatExportTime(value: string | null): string {
  if (!value) return ''
  const iso = value.replace('T', ' ')
  // `2026-09-30 12:00:03.417` → 秒；长度不足（后端以后只给到分）就原样给回，不补零。
  return iso.length > 19 ? iso.slice(0, 19) : iso
}
