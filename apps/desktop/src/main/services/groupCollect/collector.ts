// src/main/services/groupCollect/collector.ts
//
// 群事件的内存攒批器：与 `CollectorHub` 同形但**另立一份**（R4）——
// 那一份的 `BatchPayload.messages` 绑死 `NormalizedMessage`，塞进事件要动它全部泛参与 P6 的三个已验收用例。

import {
  CHAT_KEY_MAX,
  DEDUP_KEY_MAX,
  EVENT_BATCH_INTERVAL_MS,
  EVENT_BATCH_SIZE,
  EVENT_QUEUE_MAX,
  GROUP_BODY_MAX,
  MEMBER_KEY_MAX,
  type GroupEventWire
} from '../../../shared/groupMembers.ts'

export interface EventBatchPayload {
  accountId: number
  events: GroupEventWire[]
}

/** 投不出去**必须 reject**（不返回假值）：`drain()` 的退回重试只认这一种失败信号。 */
export type EventFlushFn = (payload: EventBatchPayload) => Promise<void>

export interface EventHubOptions {
  flush: EventFlushFn
  batchSize?: number
  maxQueue?: number
  flushIntervalMs?: number
  retries?: number
}

interface Item {
  accountId: number
  event: GroupEventWire
}

/**
 * 群事件的内存攒批器：与 `CollectorHub` 同形但**另立一份**（R4）——
 * 那一份的 `BatchPayload.messages` 绑死 `NormalizedMessage`，塞进事件要动它全部泛参与 P6 的三个已验收用例。
 */
export class EventCollectorHub {
  private readonly flushFn: EventFlushFn
  private readonly batchSize: number
  private readonly maxQueue: number
  private readonly intervalMs: number
  private readonly retries: number
  private queue: Item[] = []
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private droppedCount = 0
  private disposed = false

  constructor(opts: EventHubOptions) {
    this.flushFn = opts.flush
    this.batchSize = opts.batchSize ?? EVENT_BATCH_SIZE
    this.maxQueue = opts.maxQueue ?? EVENT_QUEUE_MAX
    this.intervalMs = opts.flushIntervalMs ?? EVENT_BATCH_INTERVAL_MS
    this.retries = opts.retries ?? 3
  }

  get size(): number {
    return this.queue.length
  }

  /** 越界丢掉的条数。**事件不像消息行可以重跑补底**，这一格是永久缺口的尺寸，Task 12 的日志要把它打出来。 */
  get dropped(): number {
    return this.droppedCount
  }

  /** @returns 实际收下的条数（非法的被剔掉）。差值必须能被调用方数出来，否则「页内报了、库里 0 行」无从归因。 */
  push(accountId: number, events: GroupEventWire[]): number {
    if (this.disposed || !Array.isArray(events)) return 0
    let taken = 0
    for (const raw of events) {
      const item = sanitize(accountId, raw)
      if (!item) continue
      this.queue.push(item)
      taken += 1
    }
    if (taken === 0) return 0
    this.trim()
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch(() => undefined)
      return taken
    }
    this.arm()
    return taken
  }

  flush(): Promise<void> {
    this.disarm()
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = null
    })
    return this.running
  }

  dispose(): void {
    this.disposed = true
    this.disarm()
    this.queue = []
  }

  private arm(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, this.intervalMs)
    // 主进程事件循环本来长活，这个定时器不该成为「退出不干净」的理由（同 CollectorHub）。
    this.timer.unref()
  }

  private disarm(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private trim(): void {
    if (this.queue.length <= this.maxQueue) return
    const overflow = this.queue.length - this.maxQueue
    this.queue.splice(0, overflow)
    this.droppedCount += overflow
  }

  private async drain(): Promise<void> {
    // 整队按账号分组：POST /batch 一次只带一个 accountId（R13）。
    // 同一账号的若干事件必须落同一请求，不能被到达顺序的穿插拆开——先分组再按 batchSize 切块。
    const byAccount = groupBy(this.queue)
    this.queue = []
    const blocks: EventBatchPayload[] = []
    for (const grp of byAccount) {
      for (const events of chunk(grp.events, this.batchSize)) {
        blocks.push({ accountId: grp.accountId, events })
      }
    }
    for (let i = 0; i < blocks.length; i++) {
      if (await this.deliver(blocks[i])) continue
      // 投不出去：当前块与后续块整体退回队首，保持时间顺序。
      const rest = blocks.slice(i).flatMap((b) => b.events.map((event) => ({ accountId: b.accountId, event })))
      this.queue = rest.concat(this.queue)
      this.trim()
      return
    }
  }

  private async deliver(payload: EventBatchPayload): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        await this.flushFn(payload)
        return true
      } catch (e) {
        // C3：只有计数与错误名，页内文本不进日志。
        console.warn(
          `[groupHub] 第 ${attempt}/${this.retries} 次投递失败 accountId=${payload.accountId} ` +
            `count=${payload.events.length} err=${e instanceof Error ? e.name : String(e)}`
        )
      }
    }
    return false
  }
}

/** 按账号切开：`POST /batch` 一次只带一个 `accountId`（R13 的盖章在 `handleBridgeReport`，不在这里）。 */
function groupBy(items: Item[]): EventBatchPayload[] {
  const buckets = new Map<number, GroupEventWire[]>()
  for (const item of items) {
    const list = buckets.get(item.accountId)
    if (list) list.push(item.event)
    else buckets.set(item.accountId, [item.event])
  }
  return [...buckets.entries()].map(([accountId, events]) => ({ accountId, events }))
}

/** 把数组按 size 切成块；size<=0 时退化为 1，避免死循环。 */
function chunk<T>(arr: T[], size: number): T[][] {
  const step = size > 0 ? size : 1
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += step) out.push(arr.slice(i, i + step))
  return out
}

/**
 * 长度闸在进队处，不在后端：`GroupEventDTO` 的三个键列各有 128/160/160 的 `@Size`，
 * 一条超限就是整批 400（Task 5），而这一批里其余几十条事件本来能入库。
 * 不判 `eventType` 的取值——那是 shared 联合类型与页内映射表（Task 3/4）的事，这里判就是第三份真值。
 */
function sanitize(accountId: number, raw: GroupEventWire): Item | null {
  if (!raw || typeof raw !== 'object') return null
  if (!Number.isFinite(accountId) || accountId <= 0) return null
  if (!fits(raw.chatKey, CHAT_KEY_MAX) || !fits(raw.memberKey, MEMBER_KEY_MAX) || !fits(raw.dedupKey, DEDUP_KEY_MAX)) {
    return null
  }
  if (!Number.isFinite(raw.occurredAtEpochSec)) return null
  const event: GroupEventWire = {
    ...raw,
    ...(typeof raw.bodySnapshot === 'string' && raw.bodySnapshot.length > GROUP_BODY_MAX
      ? { bodySnapshot: raw.bodySnapshot.slice(0, GROUP_BODY_MAX) }
      : {})
  }
  return { accountId, event }
}

function fits(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
