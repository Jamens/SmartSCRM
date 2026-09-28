// src/shared/batchSend.ts
export type BatchTaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type BatchDetailStatus = 'pending' | 'sending' | 'success' | 'failed' | 'unknown' | 'skipped'
export type RecallStatus = 'none' | 'recalling' | 'recalled' | 'recall_failed'

/** 只有这三个是"不再参与执行"的状态，buildQueues 与 Task 13 的徽标共用这一份判据。 */
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
  localId?: string | null
  sendStatus: BatchDetailStatus
  errorCode?: string | null
  errorDetail?: string | null
  msgKey?: string | null
  recallStatus: RecallStatus
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

/** 账号之间并行、账号内串行，所以队列形状 = 按 accountIds 顺序分组、组内 seq 升序。 */
export function buildQueues(details: BatchDetail[], accountIds: number[]): BatchDetail[][] {
  return accountIds
    .map((a) => details
      .filter((d) => d.accountId === a && !SETTLED_DETAIL_STATUS.includes(d.sendStatus))
      .sort((x, y) => x.seq - y.seq))
}

export function gapKindFor(prev: BatchDetail | null, cur: BatchDetail): IntervalKind {
  return prev && prev.chatKey === cur.chatKey && prev.accountId === cur.accountId ? 'msg' : 'chat'
}

export function pickIntervalSec(kind: IntervalKind, t: IntervalConfig, rand: () => number): number {
  const min = kind === 'msg' ? t.msgMin : t.chatMin
  const max = kind === 'msg' ? t.msgMax : t.chatMax
  if (max <= min) return min
  const r = Math.min(Math.max(rand(), 0), 0.999999)
  return Math.floor(min + r * (max - min + 1))
}

/** TIMEOUT → unknown：可能已经发出去了，把它算成失败会诱导出"再发一遍"。 */
export function outcomeStatus(receipt: { ok: boolean; error?: string }): BatchDetailStatus {
  if (receipt.ok) return 'success'
  return receipt.error === 'TIMEOUT' ? 'unknown' : 'failed'
}

export const FAIL_STREAK_LIMIT = 3
export const REPORT_BACKLOG_CAP = 500

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
