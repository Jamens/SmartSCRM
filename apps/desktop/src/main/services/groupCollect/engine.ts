// src/main/services/groupCollect/engine.ts
import {
  GROUP_GAP_MS,
  MAX_GROUPS_PER_BUILD,
  RETRY_BACKOFF_MS,
  SNAPSHOT_TIMEOUT_MS,
  type GroupParticipantWire
} from '../../../shared/groupMembers.ts'

/** 桥回执的两种形状（与 shared/chatTypes.ts 的 group_list_result / group_snapshot_result 对齐）。 */
export interface GroupListReply {
  kind: 'group_list_result'
  ok: boolean
  groups?: Array<{ chatKey: string; title: string | null }>
  error?: string
}

export interface GroupSnapshotReply {
  kind: 'group_snapshot_result'
  chatKey: string
  ok: boolean
  participants?: GroupParticipantWire[]
  participantCount?: number
  truncated?: boolean
  error?: string
}

export type GroupReply = GroupListReply | GroupSnapshotReply

export type GroupCommand =
  | { kind: 'group_list'; reqId: string }
  | { kind: 'group_snapshot'; reqId: string; chatKey: string }

/** 下命令并等回执；超时由注册表兜，这里只负责把 timeout 传下去。 */
export type GroupDispatch = (cmd: GroupCommand, timeoutMs: number) => Promise<GroupReply>

/** 一次上报的载荷：群名单 + 一个群的快照 + 一批事件（与后端 GroupMemberBatchDTO 同形）。 */
export interface IngestPayload {
  accountId: number
  groups?: Array<{ chatKey: string; title: string | null }>
  snapshot?: { chatKey: string; participants: GroupParticipantWire[] }
  events?: unknown[]
}

export interface GroupCollectApi {
  ingest(payload: IngestPayload): Promise<{ reason?: string; reconciled?: boolean }>
}

export interface GroupCollectDeps {
  api: GroupCollectApi
  dispatch: GroupDispatch
  sleep(ms: number): Promise<void>
  /** 注入时钟：测试给假时钟，host 给 () => Date.now()。 */
  now(): number
  log(where: string, e: unknown): void
  /**
   * 这个群上一次**成功**快照的时刻；null = 从没建过档。
   * 只用于排序（从没建过档的优先），不参与任何判定——判定全在后端。
   */
  snapshotAtOf(chatKey: string): number | null
}

export interface BuildResult {
  /** 成功入库的群数。 */
  built: number
  /** 拉快照失败的群数（已重试过一次）。 */
  failed: number
  /** 整轮放弃的原因；只有 group_list 拿不到时才非空。 */
  abandoned?: string
  /** 被 MAX_GROUPS_PER_BUILD 截断、留给下一轮的群数。 */
  deferred: number
}

/**
 * 群成员建档泵（spec §5）。
 *
 * 形状与 batchSend/engine.ts 同路子：依赖全注入、假时钟可测。
 * 三条硬约束：
 * 1. **每账号串行，不并发**——两个群同时拉快照会把第三方页面挤住，也会让覆盖率闸的分母在同一时刻被写两次。
 * 2. **只读**：永不进 sendLock（采集不冒充发送方），也不做任何页内写操作。
 * 3. **跑不完就留给下一轮**，不做到点定时器（spec §5 / §14）。
 */
export class GroupCollectEngine {
  private readonly deps: GroupCollectDeps
  private running = false
  private seq = 0

  constructor(deps: GroupCollectDeps) {
    this.deps = deps
  }

  get busy(): boolean {
    return this.running
  }

  /**
   * 给一个账号跑一轮建档。
   *
   * `chatKeys` 给了就只建这几个、且按传入顺序（弹层「刷新成员」用）；
   * 不给就按"从没建过档的优先"排全量，并截断到 MAX_GROUPS_PER_BUILD。
   */
  async runBuildForAccount(accountId: number, chatKeys?: string[]): Promise<BuildResult> {
    // 重入保护（引擎实例级全局锁）。宿主按账号各实例化一个 engine（dispatch 闭包已绑定该 accountId），
    // 因此这一锁实际等价于"每账号串行"——两轮并发跑同一账号的快照会用更旧的快照盖掉新的判退结论。
    // 不同账号各跑各的 engine，互不干扰；同一 engine 上的并发调用一律放弃。
    if (this.running) {
      return { built: 0, failed: 0, deferred: 0, abandoned: '上一轮还在跑' }
    }
    this.running = true
    try {
      let queue: Array<{ chatKey: string; title: string | null }>
      let deferred = 0
      if (chatKeys && chatKeys.length > 0) {
        // 指定队列（弹层「刷新成员」）：按传入顺序、全量、不排序、不截断——
        // 用户明确点哪几个就建哪几个，截断会静默丢掉用户的选择。
        queue = chatKeys.map((k) => ({ chatKey: k, title: null }))
      } else {
        const list = await this.deps.dispatch(
          { kind: 'group_list', reqId: this.nextReqId() },
          SNAPSHOT_TIMEOUT_MS
        )
        if (list.kind !== 'group_list_result' || !list.ok || !list.groups) {
          // 整轮放弃而不是"拿空名单继续"：连有哪些群都不知道时，继续跑只会写出一堆孤儿成员行。
          const why = list.kind === 'group_list_result' ? (list.error ?? 'group_list 返回 ok:false') : '回执形状不对'
          return { built: 0, failed: 0, deferred: 0, abandoned: why }
        }
        queue = this.order(list.groups)
        // 只有全量建档才截断：超大账号一轮建不完，剩下的留给下一轮（deferred 非 0 即提示宿主再来一轮）。
        if (queue.length > MAX_GROUPS_PER_BUILD) {
          deferred = queue.length - MAX_GROUPS_PER_BUILD
          queue = queue.slice(0, MAX_GROUPS_PER_BUILD)
        }
      }

      let built = 0
      let failed = 0

      for (const g of queue) {
        const snap = await this.snapshotWithRetry(g.chatKey)
        if (!snap) {
          failed += 1
          this.deps.log('groupCollect.snapshot', `群 ${g.chatKey} 快照失败，跳过`)
        } else {
          try {
            await this.deps.api.ingest({
              accountId,
              groups: [g],
              snapshot: { chatKey: g.chatKey, participants: snap }
            })
            built += 1
          } catch (e) {
            // 入库失败也算这一群没成：快照拿到了但没记上，下一轮还会重试（last_snapshot_at 没动）。
            this.deps.log('groupCollect.ingest', e)
            failed += 1
          }
        }
        await this.deps.sleep(GROUP_GAP_MS)
      }

      return { built, failed, deferred }
    } finally {
      this.running = false
    }
  }

  /** 从没建过档的排前面（null 视作最早），其余按上次快照时间升序——越久没刷新的越该先刷。 */
  private order(groups: Array<{ chatKey: string; title: string | null }>): Array<{ chatKey: string; title: string | null }> {
    return [...groups].sort((a, b) => {
      const ta = this.deps.snapshotAtOf(a.chatKey) ?? 0
      const tb = this.deps.snapshotAtOf(b.chatKey) ?? 0
      return ta - tb
    })
  }

  /**
   * 拉一次快照，失败退避后**只重试一次**。
   *
   * 重试一次是刻意的：页内拉取偶发失败很常见，但无限重试会把一个坏群钉死整轮。
   * 仍失败就返回 null，交给调用方记缺口并继续下一个群——绝不能把失败当成"这个群没人"。
   */
  private async snapshotWithRetry(chatKey: string): Promise<GroupParticipantWire[] | null> {
    const first = await this.ask(chatKey)
    if (first) return first
    await this.deps.sleep(RETRY_BACKOFF_MS)
    return this.ask(chatKey)
  }

  private async ask(chatKey: string): Promise<GroupParticipantWire[] | null> {
    try {
      const reply = await this.deps.dispatch(
        { kind: 'group_snapshot', reqId: this.nextReqId(), chatKey },
        SNAPSHOT_TIMEOUT_MS
      )
      if (reply.kind !== 'group_snapshot_result' || !reply.ok || !reply.participants) return null
      // 空名单不算成功：桥那边已经判过一次，这里再判一次是为了挡住"形状 ok 但 participants 是空数组"。
      return reply.participants.length > 0 ? reply.participants : null
    } catch {
      return null
    }
  }

  private nextReqId(): string {
    this.seq += 1
    return `gc-${this.deps.now()}-${this.seq}`
  }
}
