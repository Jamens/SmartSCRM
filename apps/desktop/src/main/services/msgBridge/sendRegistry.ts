// src/main/services/msgBridge/sendRegistry.ts
import type { MsgSource, NormalizedMessage, SendError, SendReceipt } from '../../../shared/chatTypes.ts'

interface Pending {
  viewId: string
  resolve: (receipt: SendReceipt) => void
  timer: NodeJS.Timeout
}

/**
 * localId → 未决发送。页内的 `send_result` 是异步上行的，而渲染层在 `msg:send` 的
 * invoke 上等结果，所以这里是一张 Promise 表。
 * 超时与视图销毁都必须给 invoke 一个了结，否则回复框会永久卡在 pending 气泡上。
 */
export class SendRegistry {
  private readonly table = new Map<string, Pending>()
  // 参数属性（constructor(private readonly timeoutMs)）会被 `erasableSyntaxOnly` 判成 TS1294：
  // 这个文件在 tsconfig.unit.json 的 include 里，写成字段 + 赋值。
  private readonly timeoutMs: number

  constructor(timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs
  }

  get size(): number {
    return this.table.size
  }

  pending(): string[] {
    return [...this.table.keys()]
  }

  add(localId: string, viewId: string): Promise<SendReceipt> {
    // 同 localId 再登记 = 渲染层拿同一个 id 重发。先把旧的结掉：
    // 不结的话上一条 invoke 永久挂着，界面上就是一条既不失败也不成功的幽灵气泡。
    this.settle({ localId, ok: false, error: 'SEND_FAILED', detail: 'duplicated localId' })
    return new Promise<SendReceipt>((resolve) => {
      const timer = setTimeout(() => {
        this.settle({ localId, ok: false, error: 'TIMEOUT', detail: `>${this.timeoutMs}ms` })
      }, this.timeoutMs)
      this.table.set(localId, { viewId, resolve, timer })
    })
  }

  /** @returns 命中未决表才 true；迟到或与本表无关的回执由调用方另作处理（状态推进仍要落库）。 */
  settle(receipt: SendReceipt): boolean {
    const entry = this.table.get(receipt.localId)
    if (!entry) return false
    this.table.delete(receipt.localId)
    clearTimeout(entry.timer)
    entry.resolve(receipt)
    return true
  }

  /** 视图销毁 / 桥掉线：只结这个视图的未决，别的账号不受影响。 */
  failView(viewId: string, error: SendError, detail?: string): number {
    const ids = [...this.table.entries()].filter(([, p]) => p.viewId === viewId).map(([id]) => id)
    for (const id of ids) this.settle({ localId: id, ok: false, error, detail })
    return ids.length
  }

  dispose(): void {
    for (const entry of this.table.values()) clearTimeout(entry.timer)
    this.table.clear()
  }
}

interface Intent {
  localId: string
  viewId: string
  chatKey: string
  text: string
  at: number
}

export interface AttributionOptions {
  /** intent 活了多久就不再被事件流认领。 */
  maxAgeMs?: number
  /** 已知 msgKey 的保留时长：事件流可能比回执晚到很久（弱网 / 页面卡顿）。 */
  knownMs?: number
  now?: () => number
}

const DEFAULT_MAX_AGE_MS = 90_000
const DEFAULT_KNOWN_MS = 10 * 60_000
/** byMsgKey 的硬上限：这是主进程里的常驻内存，不能随消息量长。 */
const MAX_KNOWN = 5_000
/** 过期 intent 只留最近这么多条用于"迟到回执补写"，再多就是无意义的内存。 */
const MAX_EXPIRED = 200

/** 补写那一行需要的最小原文：只有主进程有（页内回执不带正文，C3 之外还省一份拷贝）。 */
export interface SendIntentMeta {
  chatKey: string
  text: string
}

/**
 * localId ⇄ msgKey 的双向登记。两条写入路径（事件流 / 发送回执）都来这里问一次，
 * 于是"谁先到"不再影响 `source` 的最终取值。
 * 认领规则刻意保守：只有同视图、同会话、同文本（FIFO）才允许在无 msgKey 时认领，
 * 认错的代价（把用户手发的消息算成本应用发的）比认漏（退化成 native_send + 一条重复写）高。
 */
export class SendAttribution {
  private readonly intents = new Map<string, Intent>()
  private readonly byMsgKey = new Map<string, { localId: string; at: number }>()
  /**
   * 过期不代表"不是本应用发的"，只代表 intent 表把它忘了。回执仍带 localId 回来时，
   * 用这份短命副本把补写所需的原文捞回来（上限 `MAX_EXPIRED` 条，只保这一份）。
   */
  private readonly expired = new Map<string, Intent>()
  private readonly maxAgeMs: number
  private readonly knownMs: number
  private readonly now: () => number

  constructor(opts: AttributionOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.knownMs = opts.knownMs ?? DEFAULT_KNOWN_MS
    this.now = opts.now ?? Date.now
  }

  claim(viewId: string, localId: string, chatKey: string, text: string): void {
    this.intents.set(localId, { localId, viewId, chatKey, text, at: this.now() })
  }

  /**
   * 成功回执。@returns 事件流还没写过这一行时返回补写所需的原文，否则 null。
   * 三种落地：事件流已消化（false 路径 → null）、本表刚消掉 intent（meta）、
   * intent 已过期但回执仍到了（也要补写——那一刻主进程确实知道发出去了什么）。
   */
  settle(localId: string, msgKey: string): SendIntentMeta | null {
    const intent = this.intents.get(localId)
    this.intents.delete(localId)
    const now = this.now()
    if (this.byMsgKey.has(msgKey)) return null
    const meta = intent ?? this.recovered(localId)
    if (!meta) return null
    this.byMsgKey.set(msgKey, { localId, at: now })
    this.trim()
    return { chatKey: meta.chatKey, text: meta.text }
  }

  /** 失败 / 超时回执：intent 必须立刻失效，否则同会话同文本的原生消息会被误认领。 */
  abandon(localId: string): void {
    this.intents.delete(localId)
  }

  /** 盖 `source` / `sendLocalId` 之外的字段一律不动；in 行原样返回（同一个对象引用）。 */
  stamp(viewId: string, msg: NormalizedMessage): NormalizedMessage {
    if (msg.direction !== 'out') return msg
    const now = this.now()
    this.sweep(now)
    const known = this.byMsgKey.get(msg.msgKey)
    if (known) {
      known.at = now
      return withSource(msg, 'app_send', known.localId)
    }
    const queued = [...this.intents.values()]
      .filter((i) => i.viewId === viewId && i.chatKey === msg.chatKey && i.text === (msg.body ?? ''))
      .sort((a, b) => a.at - b.at)[0]
    if (!queued) return withSource(msg, 'native_send')
    this.intents.delete(queued.localId)
    this.byMsgKey.set(msg.msgKey, { localId: queued.localId, at: now })
    this.trim()
    return withSource(msg, 'app_send', queued.localId)
  }

  dropView(viewId: string): number {
    const ids = [...this.intents.values()].filter((i) => i.viewId === viewId).map((i) => i.localId)
    for (const id of ids) this.intents.delete(id)
    return ids.length
  }

  pendingIntents(): string[] {
    return [...this.intents.keys()]
  }

  private sweep(now: number): void {
    for (const [id, i] of this.intents) {
      if (now - i.at <= this.maxAgeMs) continue
      this.intents.delete(id)
      this.expired.set(id, i)
    }
    while (this.expired.size > MAX_EXPIRED) {
      const oldest = this.expired.keys().next().value
      if (oldest === undefined) break
      this.expired.delete(oldest)
    }
    for (const [key, v] of this.byMsgKey) if (now - v.at > this.knownMs) this.byMsgKey.delete(key)
  }

  private recovered(localId: string): Intent | undefined {
    return this.expired.get(localId)
  }

  private trim(): void {
    if (this.byMsgKey.size <= MAX_KNOWN) return
    // Map 的迭代顺序就是插入顺序：从头删最旧的。
    for (const key of [...this.byMsgKey.keys()].slice(0, this.byMsgKey.size - MAX_KNOWN)) {
      this.byMsgKey.delete(key)
    }
  }
}

function withSource(msg: NormalizedMessage, source: MsgSource, sendLocalId?: string): NormalizedMessage {
  return { ...msg, source, ...(sendLocalId ? { sendLocalId } : { sendLocalId: undefined }) }
}
