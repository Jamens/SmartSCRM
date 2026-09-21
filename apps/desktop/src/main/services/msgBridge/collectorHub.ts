// src/main/services/msgBridge/collectorHub.ts
import type { LiveFrame, NormalizedMessage } from '../../../shared/chatTypes.ts'

export interface BatchPayload {
  accountId: number
  activeChatKey: string | null
  messages: NormalizedMessage[]
}

/** 与后端 `BatchAcceptVO` 同形；主进程只用 accepted/duplicated 做日志。 */
export interface BatchResult {
  accepted: number
  duplicated: number
  rejected: number
  reasons: string[]
}

export type FlushFn = (payload: BatchPayload) => Promise<BatchResult>

export interface HubOptions {
  flush: FlushFn
  /** spec §4：500 条或 2s 先到先冲。 */
  batchSize?: number
  maxQueue?: number
  flushIntervalMs?: number
  retries?: number
}

interface Item {
  accountId: number
  activeChatKey: string | null
  message: NormalizedMessage
}

const groupKey = (item: Item): string => `${item.accountId}|${item.activeChatKey ?? ''}`

function groupOf(items: Item[]): BatchPayload {
  return {
    accountId: items[0].accountId,
    activeChatKey: items[0].activeChatKey,
    messages: items.map((i) => i.message)
  }
}

/** 一个批次可能横跨多个会话/账号：后端按 (accountId, activeChatKey) 决定未读数与归属，所以必须先分组再投。 */
function groupBy(items: Item[]): BatchPayload[] {
  const buckets = new Map<string, Item[]>()
  for (const item of items) {
    const key = groupKey(item)
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.values()].map(groupOf)
}

/**
 * 采集的内存缓冲：页内事件是持续流，后端写入是批量。
 * 三条边界都来自 spec §4 / §9：攒够冲、到点冲、装不下丢最旧。
 * 投递失败时不丢数据，把没投出去的组放回队首等下一次触发——DB 恢复后自然续上。
 */
export class CollectorHub {
  private readonly flushFn: FlushFn
  private readonly batchSize: number
  private readonly maxQueue: number
  private readonly intervalMs: number
  private readonly retries: number
  private queue: Item[] = []
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private droppedCount = 0
  private disposed = false

  constructor(opts: HubOptions) {
    this.flushFn = opts.flush
    this.batchSize = opts.batchSize ?? 500
    this.maxQueue = opts.maxQueue ?? 10_000
    this.intervalMs = opts.flushIntervalMs ?? 2_000
    this.retries = opts.retries ?? 3
  }

  get dropped(): number {
    return this.droppedCount
  }

  size(): number {
    return this.queue.length
  }

  push(frame: LiveFrame): void {
    if (this.disposed) return
    this.queue.push({
      accountId: frame.accountId,
      activeChatKey: frame.activeChatKey ?? null,
      message: frame.message
    })
    this.trim()
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch(() => undefined)
      return
    }
    this.arm()
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
    // 主进程的事件循环本来就长活，这个定时器不该成为"退出不干净"的理由。
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
    while (this.queue.length > 0) {
      const groups = groupBy(this.queue.splice(0, this.batchSize))
      for (let i = 0; i < groups.length; i++) {
        if (await this.deliver(groups[i])) continue
        // 投不出去：这一组和它后面还没投的全部退回队首，保持时间顺序。
        const rest = groups
          .slice(i)
          .flatMap((g) => g.messages.map((message) => ({
            accountId: g.accountId,
            activeChatKey: g.activeChatKey,
            message
          })))
        this.queue = rest.concat(this.queue)
        this.trim()
        return
      }
    }
  }

  private async deliver(payload: BatchPayload): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const result = await this.flushFn(payload)
        reportRejected(payload, result)
        return true
      } catch (e) {
        // C3：日志只有计数与错误名，消息正文不进日志。
        console.warn(
          `[msgHub] 第 ${attempt}/${this.retries} 次投递失败 accountId=${payload.accountId} ` +
            `count=${payload.messages.length} err=${e instanceof Error ? e.name : String(e)}`
        )
      }
    }
    return false
  }
}

/** 后端 reason 的形态是 `<msgKey>: <固定文案>`，冒号后面才是给人看的那半句。 */
const REASON_MAX = 3

function reasonText(reason: string): string {
  const idx = reason.indexOf(':')
  // 没有冒号就整条都是页面侧来的字符串，按 C3 收成一行并限长，别给它伪造日志行的机会。
  const tail = idx < 0 ? reason : reason.slice(idx + 1)
  return tail.replace(/[\r\n\p{Cc}]/gu, ' ').trim().slice(0, 40)
}

/**
 * 逐行拒绝与"投递失败"是两件事：失败会退回重试，而 `chat_key 与平台不匹配` 这类拒绝重试一万次
 * 也不会成功。它同样不能静默——发送链把 ok 还给渲染层之后，这一行是唯一能把"页内发了"与
 * "库里有"接上的地方（Task 12 行 7 实测：坏 chatKey 在页内建成了会话、回执 ok，库里却 0 行）。
 */
function reportRejected(payload: BatchPayload, result: BatchResult | void): void {
  if (!result || result.rejected <= 0) return
  const reasons = [...new Set((result.reasons ?? []).map(reasonText))].filter(Boolean).slice(0, REASON_MAX)
  console.warn(
    `[msgHub] 本批拒绝 ${result.rejected}/${payload.messages.length} 条 accountId=${payload.accountId} ` +
      `chatKey=${payload.activeChatKey ?? '-'} reasons=${reasons.join(' | ') || '未给原因'}`
  )
}
