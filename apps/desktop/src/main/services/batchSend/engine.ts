// src/main/services/batchSend/engine.ts
import {
  FAIL_STREAK_LIMIT, ReportBacklog, buildQueues, gapKindFor, outcomeStatus, pickIntervalSec
} from '../../../shared/batchSend.ts'
import type { BatchApi, RecallTarget, ReportItem } from './batchApi.ts'
import type { BatchDetail, BatchTask, IntervalConfig } from '../../../shared/batchSend.ts'

/** 出料口的结果形状：真发是页内回执，演练是 host 造的假回执（两条都要给 msgKey）。 */
export interface SendOutcome {
  ok: boolean
  msgKey?: string
  error?: string
  detail?: string
}

/** localId 由引擎生成、随两跳上报一起走：页内回执要靠它与这一行对齐（Task 9 的归属登记）。 */
export type Dispatch = (d: BatchDetail, viewId: string, localId: string) => Promise<SendOutcome>

/**
 * 撤回出料口的形状声明在这里（与 Dispatch 同处，方便对照），但**编排在 host**（Task 12 Step 4）：
 * 撤回是一次性的短扇出，没有队列、没有节律、没有熔断，塞进引擎只会多一格没人用的依赖。
 */
export type RecallDispatch = (t: RecallTarget) =>
  Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }>

export interface EngineDeps {
  api: BatchApi
  dispatch: Dispatch
  viewIdOf(accountId: number): string | null
  sleep(ms: number): Promise<void>
  rand(): number
  /** 注入时钟：测试给固定值，host 给 () => Date.now()。 */
  now(): number
  log(where: string, e: unknown): void
}

/** 积压单元：一整批上报 + 它当时的结论，重报时两样都不能改。 */
interface BacklogEntry {
  taskId: number
  items: ReportItem[]
  allHalted: boolean
}

/**
 * 执行环：只做三件事——排队、投料、如实上报。任何"能不能从 X 到 Y"的判断都在后端（BatchStatus），
 * 这里不裁决状态，所以引擎崩了也不会写出一个后端不认的状态。
 */
export class BatchEngine {
  // erasableSyntaxOnly 下不许写参数属性：deps 显式声明字段，构造器里赋值。
  private readonly deps: EngineDeps
  private stopped = false
  private seq = 0
  /** 熔断的是账号，不是任务：halted 记 accountId，收尾据此判"是不是全部账号都停了"。 */
  private readonly halted = new Set<number>()
  private readonly backlog = new ReportBacklog<BacklogEntry>()

  constructor(deps: EngineDeps) {
    this.deps = deps
  }

  async start(task: BatchTask, details: BatchDetail[]): Promise<void> {
    this.stopped = false
    const queues = buildQueues(details, task.accountIds)
    await Promise.all(queues.map((q) => this.pump(task, q)))
    await this.settle(task, queues)
  }

  /** host.ts 在下一次心跳前调用：把后端不可达期间攒下的上报按序倒出去。 */
  async flushBacklog(): Promise<void> {
    const pending = this.backlog.drain()
    for (let i = 0; i < pending.length; i++) {
      if (!(await this.send(pending[i].taskId, pending[i].items, pending[i].allHalted))) {
        // 倒不动就整段按原序塞回去：后端还没起来，继续试只会把新条目挤成"丢最旧"。
        for (const entry of pending.slice(i)) this.backlog.push(entry)
        return
      }
    }
  }

  stop(): void {
    this.stopped = true
  }

  /** 一个账号一条串行泵：投料前后各上报一跳，连续 FAIL_STREAK_LIMIT 条失败就熔断这一个账号。 */
  private async pump(task: BatchTask, queue: BatchDetail[]): Promise<void> {
    if (!queue.length) return
    const accountId = queue[0].accountId
    const viewId = this.deps.viewIdOf(accountId)
    if (!viewId) {
      await this.report(task, queue.map((d) => ({
        detailId: d.id, sendStatus: 'skipped', errorCode: 'BRIDGE_OFFLINE', errorDetail: '账号没有绑定视图'
      })), false)
      this.halted.add(accountId)
      return
    }
    const cfg: IntervalConfig = {
      msgMin: task.msgIntervalMin, msgMax: task.msgIntervalMax,
      chatMin: task.chatIntervalMin, chatMax: task.chatIntervalMax
    }
    let prev: BatchDetail | null = null
    let streak = 0
    for (let i = 0; i < queue.length; i++) {
      const d = queue[i]
      if (this.stopped) {
        await this.report(task, [{ detailId: d.id, sendStatus: 'skipped', errorCode: 'TASK_HALT' }], false)
        continue
      }
      const localId = `b${task.id}-${d.id}-${(this.seq += 1)}`
      await this.report(task, [{ detailId: d.id, sendStatus: 'sending', localId }], false)
      // catch 的返回值要显式标成 SendOutcome：只写 `satisfies` 的话 TS 留的是那个窄字面量类型
      // （没有 msgKey 那一格），下面 `outcome.msgKey` 就在 union 上取不到属性、typecheck 直接红。
      const outcome = await this.deps.dispatch(d, viewId, localId).catch((e: unknown): SendOutcome => {
        this.deps.log('dispatch', e)
        return { ok: false, error: 'SEND_FAILED', detail: e instanceof Error ? e.message : String(e) } satisfies SendOutcome
      })
      const sendStatus = outcomeStatus(outcome)
      const item: ReportItem = { detailId: d.id, sendStatus, localId }
      if (sendStatus === 'success') {
        // 演练的 msgKey（dryrun:<detailId>）由出料口给（Task 12），引擎不造它：
        // 真发回执缺 msgKey 就如实留空——撤回那侧会点名"这一条没有 msg_key"，比编一个假键好查。
        if (outcome.msgKey) item.msgKey = outcome.msgKey
        item.sentAtEpochSec = Math.floor(this.deps.now() / 1000)
      } else {
        item.errorCode = outcome.error ?? 'SEND_FAILED'
        item.errorDetail = outcome.detail
      }
      await this.report(task, [item], false)
      streak = sendStatus === 'failed' ? streak + 1 : 0
      prev = d
      if (streak >= FAIL_STREAK_LIMIT) {
        await this.report(task, queue.slice(i + 1).map((r) => ({
          detailId: r.id, sendStatus: 'skipped', errorCode: 'ACCOUNT_HALT'
        })), false)
        this.halted.add(accountId)
        return
      }
      const next = queue[i + 1]
      if (next) {
        await this.deps.sleep(pickIntervalSec(gapKindFor(prev, next), cfg, this.deps.rand) * 1000)
      }
    }
  }

  private async settle(task: BatchTask, queues: BatchDetail[][]): Promise<void> {
    const active = queues.filter((q) => q.length).length
    const allHalted = active > 0 && this.halted.size >= active
    // 收尾那一跳只带结论：items=[] 合法（BatchReportsDTO 的 items 不加 @NotEmpty），
    // 后端拿 allHalted 与 openCount 判 running→error / running→done（Task 5 Step 2）。
    await this.report(task, [], allHalted)
  }

  private async report(task: BatchTask, items: ReportItem[], allHalted: boolean): Promise<void> {
    if (!(await this.send(task.id, items, allHalted))) {
      this.backlog.push({ taskId: task.id, items, allHalted })
    }
  }

  /** 一跳上报的成与不成：batchApi 把"后端不可达"折成 null（Task 8），所以 null 就是没落地。 */
  private async send(taskId: number, items: ReportItem[], allHalted: boolean): Promise<boolean> {
    try {
      return (await this.deps.api.reports(taskId, items, allHalted)) !== null
    } catch (e) {
      this.deps.log('reports', e)
      return false
    }
  }
}
