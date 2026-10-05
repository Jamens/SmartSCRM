// src/shared/batchSend.ts
import type { ButtonSpec } from './chatTypes.ts'
export type BatchTaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type BatchDetailStatus = 'pending' | 'sending' | 'success' | 'failed' | 'unknown' | 'skipped'
export type RecallStatus = 'none' | 'recalling' | 'recalled' | 'recall_failed'

/**
 * 「人还能不能处置这一行」= 已经收口。Task 13/15 的徽标与「重发这一条」按钮读它。
 * 这条判据**不**用来决定泵该发谁（那一条只有 `pending` 算数，见 `buildQueues`）：
 * `failed` 在这里必须算"没收口"，否则重试按钮点不动；它对泵又必须是"别再发一遍"。
 */
export const SETTLED_DETAIL_STATUS: readonly BatchDetailStatus[] = ['success', 'unknown', 'skipped']

export interface BatchDetail {
  id: number
  taskId: number
  seq: number
  accountId: number
  chatKey: string
  customerId?: number | null
  contentIndex: number
  body: string
  /** B17 P5：按钮素材群发链。明细行带按钮时，经 `realDispatch` → `sendText` 透传给 wa-js。普通文本群发不带。 */
  buttons?: ButtonSpec[]
  localId?: string | null
  sendStatus: BatchDetailStatus
  errorCode?: string | null
  errorDetail?: string | null
  msgKey?: string | null
  recallStatus: RecallStatus
  /** 页内撤回四态的逐条结论文案（后端 `recall_detail`）；没撤过就为空。 */
  recallDetail?: string | null
  /** 后端 VO 的墙钟串（不带偏移），显示走 `chatMs` + `chatClock`；引擎只写不回读，所以可选。 */
  sentAt?: string | null
}

export interface BatchTask {
  id: number
  name: string
  platform: string
  dryRun: boolean
  status: BatchTaskStatus
  accountIds: number[]
  contents: string[]
  msgIntervalMin: number
  msgIntervalMax: number
  chatIntervalMin: number
  chatIntervalMax: number
  totalCount: number
  sentCount: number
  failCount: number
  /**
   * 后端 `LocalDateTime` 出来的墙钟串（`'2026-09-28T13:04:05'`，不带偏移），与
   * `api/messages.ts` 的 `lastMsgTime: string | null` 同一口径；解析只准用 `chatMs`（补 `+08:00`），
   * 直接 `dayjs(串)` 会在非东八区机器上按浏览器时区偏一次。
   */
  heartbeatAt?: string | null
  /** 与 `heartbeatAt` 同一口径的墙钟串（后端 `created_at` 原样透传）；列表按它排序展示，解析同样只准走 `chatMs`。 */
  createdAt?: string | null
}

export interface IntervalConfig { msgMin: number; msgMax: number; chatMin: number; chatMax: number }
export type IntervalKind = 'msg' | 'chat'

/**
 * `batch:state` 的载荷。它只是"进度变了"的通知：数字仍然以 GET 回来的那一份为准，
 * 渲染层不拿它当状态源（Task 13 的 useBatchLive 收到就 refetch）。
 */
export interface BatchStateEvent {
  taskId: number
  status: BatchTaskStatus
  totalCount: number
  sentCount: number
  failCount: number
}

/**
 * 运行面四个迁移（start/pause/resume/cancel）与 reports 的出参 = 后端 `BatchReportsResultVO` 的四列，
 * 不是整张任务：它没有 name/contents/间隔。放在 shared 是因为 preload 与渲染层都要认它，
 * 而 preload 不许 import `main/services/**`（两个 tsconfig 范围）。
 * 整张任务只有 `GET /tasks/{id}` 一条路（`BatchTask`）。
 */
export interface BatchProgress {
  sentCount: number
  failCount: number
  totalCount: number
  status: BatchTaskStatus
}

/** 撤回清单里被后端挡下的那一条（后端 `BatchRecallVO.Blocked`）。 */
export interface BatchRecallBlocked { detailId: number; reason: string }

/**
 * `batch:recall` 的出参：`eligible` 是条数（真撤的那几行没有回执可等，逐条结论走明细的
 * `recallDetail`），`blocked` 带着**逐条理由**。理由不能压成一个数：Task 15 的折叠区要点名
 * "这几条为什么没撤"，而挡下的行后端不写库，界面上除了这一份就再无出处。
 */
export interface BatchRecallResult { eligible: number; blocked: BatchRecallBlocked[] }

/**
 * 账号之间并行、账号内串行，所以队列形状 = 按 accountIds 顺序分组、组内 seq 升序。
 * 泵只捡 `pending` 行：进 `sending` 的唯一 arrow 是 `pending → sending`（spec:96），
 * `failed` 要回队必须由人走 `retry-failed`（spec:136）——别把这里改成读 `SETTLED_DETAIL_STATUS`，
 * 那一份判据答的是「人还能不能处置这一行」，拿它决定投料会把单条重发变成全部重发。
 */
export function buildQueues(details: BatchDetail[], accountIds: number[]): BatchDetail[][] {
  return accountIds
    .map((a) => details
      .filter((d) => d.accountId === a && d.sendStatus === 'pending')
      .sort((x, y) => x.seq - y.seq))
}

/**
 * `gapKindFor` 只读 `accountId` 与 `chatKey` 两个字段：参数类型写成最小结构类型而不是 `BatchDetail`，
 * 是为了让撤回循环 (`host.ts` 的 `batch:recall`) 也能直接把手上的 `RecallTarget` 递进来复用这一条判据。
 * 复制一份新函数就会有两张真值表；这里合并成一处，改一边一定看得见另一边（Task 12 I-5 节律）。
 */
export function gapKindFor(
  prev: { accountId: number; chatKey: string } | null,
  cur: { accountId: number; chatKey: string }
): IntervalKind {
  return prev && prev.chatKey === cur.chatKey && prev.accountId === cur.accountId ? 'msg' : 'chat'
}

export function pickIntervalSec(kind: IntervalKind, t: IntervalConfig, rand: () => number): number {
  const min = kind === 'msg' ? t.msgMin : t.chatMin
  const max = kind === 'msg' ? t.msgMax : t.chatMax
  if (max <= min) return min
  // 非有限值（NaN / ±Infinity）一律走区间下界：NaN 会一路穿到 Task 11 的 setTimeout，
  // 而 `setTimeout(fn, NaN)` 等于立刻触发——节律保护正是它该护住账号的那一格就这样没了。
  const raw = rand()
  const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0
  return Math.floor(min + r * (max - min + 1))
}

/** TIMEOUT → unknown：可能已经发出去了，把它算成失败会诱导出"再发一遍"。 */
export function outcomeStatus(receipt: { ok: boolean; error?: string }): BatchDetailStatus {
  if (receipt.ok) return 'success'
  return receipt.error === 'TIMEOUT' ? 'unknown' : 'failed'
}

export const FAIL_STREAK_LIMIT = 3
export const REPORT_BACKLOG_CAP = 500

/**
 * 上报体 `errorDetail` / 撤回 `detail` 的字节上限——后端两列 `@Size(max=255)` 的镜像
 * （`BatchReportItemDTO.errorDetail`、`BatchRecallReportItemDTO.detail`）。越界那一跳会 400 →
 * `batchApi` 折成 `null` → 整条进 `ReportBacklog`；`flushBacklog` 倒不动会把整段按原序塞回，
 * 毒条目永远在队头，后面每一条合法上报都永久陪葬——所以这条截断不是"美化"，是保 backlog 不被卡死。
 */
export const REPORT_DETAIL_MAX = 255

/** 后端不可达时的内存积压：溢出丢最旧并计数，恢复后按序重报。 */
export class ReportBacklog<T> {
  private readonly items: T[] = []
  dropped = 0

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > REPORT_BACKLOG_CAP) {
      this.items.shift()
      this.dropped += 1
    }
  }

  drain(): T[] {
    return this.items.splice(0, this.items.length)
  }

  get size(): number {
    return this.items.length
  }
}
