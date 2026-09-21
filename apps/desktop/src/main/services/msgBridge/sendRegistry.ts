// src/main/services/msgBridge/sendRegistry.ts
import type { SendError, SendReceipt } from '../../../shared/chatTypes.ts'

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
