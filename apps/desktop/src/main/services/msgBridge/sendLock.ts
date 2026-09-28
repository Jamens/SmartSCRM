// src/main/services/msgBridge/sendLock.ts
/**
 * per-view 串行闸门：同一个视图同一时刻只允许一条 send/recall 在页内飞。
 * 群发与回复框共用它（spec §5）——归属认领的判据是"同视图+同会话+同文本 FIFO"，
 * 让两条并发就是把认错的口子摊开；代价是手动回复最坏多等一条间隔。
 * <p>
 * 实现是"每个 view 一条尾链"：链上任何一环失败都必须被吞掉再往下走，
 * 否则一次页内异常会留下一个 rejected tail，之后每一条都排队去撞同一个死 promise。
 */
export class SendLock {
  // erasableSyntaxOnly 下不许写参数属性，两个 map 都在类顶部声明。
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly count = new Map<string, number>()

  pending(viewId?: string): number {
    if (viewId !== undefined) return this.count.get(viewId) ?? 0
    return [...this.count.values()].reduce((a, b) => a + b, 0)
  }

  async run<T>(viewId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(viewId)
    // 计数在第一个 await 之前加：测试要在调用后同步读到 pending。
    this.count.set(viewId, (this.count.get(viewId) ?? 0) + 1)
    // done 只给队尾当"这一环结束了"的信号（成功失败都一样）；调用方拿的是 job 自己的结果。
    let release!: () => void
    const done = new Promise<void>((r) => { release = r })
    this.tails.set(viewId, done)
    // 队首（prev 为 undefined）直接同步启动 job，保证外部在同一个同步段就能拿到 promise resolve；
    // 排队时等 prev 兑现再启动——这才是串行的真正来源。
    const result = prev ? prev.catch(() => undefined).then(job) : job()
    try {
      return await result
    } finally {
      this.count.set(viewId, (this.count.get(viewId) ?? 1) - 1)
      release()
      if (this.tails.get(viewId) === done) this.tails.delete(viewId)
    }
  }

  /** 视图销毁：把这座岛摘掉，别让旧 viewId 的尾链挂进新会话。 */
  dropView(viewId: string): void {
    this.tails.delete(viewId)
    this.count.delete(viewId)
  }
}
