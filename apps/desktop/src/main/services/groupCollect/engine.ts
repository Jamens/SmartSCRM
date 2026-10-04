// src/main/services/groupCollect/engine.ts
import {
  GROUP_GAP_MS,
  MAX_GROUPS_PER_BUILD,
  RETRY_BACKOFF_MS,
  SNAPSHOT_TIMEOUT_MS,
  oneLine,
  type GroupBuildOutcome,
  type GroupParticipantWire
} from '../../../shared/groupMembers.ts'

export type { GroupBuildOutcome }

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

/**
 * 后端 `sort=stale` 那一页抽出来的排序原料（只关心键与总数）。
 *
 * `keys` = 已登记群按「未建档最前、已建档按上次成功快照从旧到新」的位置序；
 * `total` = 该账号在 `chat_group` 里登记过的群总数。两者的差决定了 `keys` 之外的那些群
 * 到底是「一行都没登记过」还是「登记了但没挤进这一页」——见 {@link GroupCollectEngine.orderByStale}。
 */
export interface StaleGroupPage {
  keys: string[]
  total: number
}

export interface GroupCollectApi {
  ingest(payload: IngestPayload): Promise<{ reason?: string; reconciled?: boolean }>
  /**
   * 取 `GET /api/group-members/groups?sort=stale` 的排序页（R28 / R41：位置即 rank）。
   * 失败就抛——泵把它当"这一轮拿不到排序依据"，退化成保桥次序，绝不当成"这个账号没有群"。
   */
  staleGroups(accountId: number, size: number): Promise<StaleGroupPage>
}

export interface GroupCollectDeps {
  api: GroupCollectApi
  dispatch: GroupDispatch
  sleep(ms: number): Promise<void>
  /** 注入时钟：测试给假时钟，host 给 () => Date.now()。 */
  now(): number
  log(where: string, e: unknown): void
}

/**
 * 一轮建档的结论。
 *
 * 类型活在 shared 而不是这里：`window.scrm.group.build` 的返回类型要经 preload，
 * 而 preload 不许 import `main/services/**`（与 `batchSend.ts` 的 `BatchProgress` 同一条边界）。
 * 计数口径：`registered` 入库成功、`postedFailed` 入库抛错、`snapshotted` 快照拿到、
 * `failed` 快照没拿到——后两者分开是因为"拉到了但没记上"与"压根没拉到"下一步动作不同。
 */

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
   * `chatKey` 给了就**只建这一个**（弹层「刷新成员」，R49 单数码）；
   * 不给就按后端 `sort=stale` 那一页的位置排全量（未建档的优先），并截断到 MAX_GROUPS_PER_BUILD。
   *
   * 可预期失败都结进 outcome 的字段，不抛——调用方（host）据此广播一条 settled，
   * 界面不会永远灰在 running 那一格。
   */
  async runBuildForAccount(accountId: number, chatKey?: string): Promise<GroupBuildOutcome> {
    const out: GroupBuildOutcome = {
      accountId,
      skipped: null,
      list: 'ok',
      registered: 0,
      attempted: 0,
      snapshotted: 0,
      postedFailed: 0,
      failed: 0,
      // 桥的 group_list_result 目前不带 is_final（bridge/whatsapp/groups.ts 注明是后续），
      // 所以恒为 0——这是"因这个原因跳过了 0 个"的真值，不是占位。
      skippedFinal: 0,
      truncated: false,
      aborted: false
    }
    // 重入保护（引擎实例级全局锁）。宿主按账号各实例化一个 engine（dispatch 闭包已绑定该 accountId），
    // 因此这一锁实际等价于"每账号串行"——两轮并发跑同一账号的快照会用更旧的快照盖掉新的判退结论。
    // 不同账号各跑各的 engine，互不干扰；同一 engine 上的并发调用一律放弃。
    if (this.running) {
      out.skipped = 'busy'
      return out
    }
    this.running = true
    try {
      let queue: Array<{ chatKey: string; title: string | null }>
      if (chatKey) {
        // 指定单群（弹层「刷新成员」）：不排序、不截断——用户点哪一个就补哪一个，
        // 截断会静默丢掉用户的选择。
        queue = [{ chatKey, title: null }]
      } else {
        let list: GroupReply
        try {
          list = await this.deps.dispatch(
            { kind: 'group_list', reqId: this.nextReqId() },
            SNAPSHOT_TIMEOUT_MS
          )
        } catch (e) {
          // 页内没给答案：命令推不出去 / 视图已销毁。这与"页内答了但 ok:false"不是一回事
          // （前者该等会话上线，后者是页内能力缺失），所以 list 分成 'silent' 与 'error' 两档。
          this.deps.log('groupCollect.list', e)
          out.list = 'silent'
          out.aborted = true
          return out
        }
        if (list.kind !== 'group_list_result' || !list.ok || !list.groups) {
          // 整轮放弃而不是"拿空名单继续"：连有哪些群都不知道时，继续跑只会写出一堆孤儿成员行。
          const why = oneLine(
            list.kind === 'group_list_result' ? (list.error ?? 'group_list 返回 ok:false') : '回执形状不对'
          )
          this.deps.log('groupCollect.list', why)
          out.list = 'error'
          out.aborted = true
          return out
        }
        queue = await this.orderByStale(list.groups, accountId)
        // 只有全量建档才截断：超大账号一轮建不完，剩下的留给下一轮（truncated 为真即提示宿主再来一轮）。
        if (queue.length > MAX_GROUPS_PER_BUILD) {
          out.truncated = true
          queue = queue.slice(0, MAX_GROUPS_PER_BUILD)
        }
      }

      out.attempted = queue.length

      for (const g of queue) {
        const snap = await this.snapshotWithRetry(g.chatKey)
        if (!snap) {
          out.failed += 1
          this.deps.log('groupCollect.snapshot', `群 ${g.chatKey} 快照失败，跳过`)
        } else {
          out.snapshotted += 1
          try {
            await this.deps.api.ingest({
              accountId,
              groups: [g],
              snapshot: { chatKey: g.chatKey, participants: snap }
            })
            out.registered += 1
          } catch (e) {
            // 入库失败也算这一群没成：快照拿到了但没记上，下一轮还会重试（last_snapshot_at 没动）。
            this.deps.log('groupCollect.ingest', e)
            out.postedFailed += 1
          }
        }
        await this.deps.sleep(GROUP_GAP_MS)
      }

      return out
    } finally {
      this.running = false
    }
  }

  /**
   * 队列次序 = 后端 `sort=stale` 那一页的位置（R28 / R41：未建档最前、位置即 rank）。
   *
   * 为什么由后端排而不是泵自己猜：`chat_group.last_snapshot_at` 只在**成功快照入库**时才写，
   * 主进程手里没有第二个可信来源（旧实现注入的 `snapshotAtOf` 恒给 null，等于没排序）。
   *
   * `keys` 之外的桥群分两种情形，靠 `total` 分开：
   * - **`total <= keys.length`（这一页就是全集）**：不在页里 = `chat_group` 里一行都没有 = 从没建过档，
   *   按 R28 排最前（它们缺的是"完全没有成员数据"，比"有数据但旧"更急）。
   * - **`total > keys.length`（被 size 截过）**：分不清是"没登记"还是"登记了但没这旧"，
   *   保守地把它们垫在整页之后、保桥次序——把一群可能已经很新的群顶到最前，
   *   代价是把真正的旧群挤出这一轮，比反过来更糟。
   *
   * 读口失败（后端不可达 / 没登录 / 形状不对）就**保桥次序继续跑**并记一条日志：
   * 排序只是优化，不是判定——为了它放弃整轮等于"补不了旧群"升级成"一个群都不补"。
   */
  private async orderByStale(
    groups: Array<{ chatKey: string; title: string | null }>,
    accountId: number
  ): Promise<Array<{ chatKey: string; title: string | null }>> {
    let page: StaleGroupPage
    try {
      page = await this.deps.api.staleGroups(accountId, MAX_GROUPS_PER_BUILD)
    } catch (e) {
      this.deps.log('groupCollect.stale', e)
      return groups
    }
    const rank = new Map(page.keys.map((k, i) => [k, i]))
    const ranked = groups.filter((g) => rank.has(g.chatKey))
      .sort((a, b) => rank.get(a.chatKey)! - rank.get(b.chatKey)!)
    const rest = groups.filter((g) => !rank.has(g.chatKey))
    // 全集在手时未登记的排最前，否则垫后——两种情形的理由见上面那段。
    return page.total <= page.keys.length ? [...rest, ...ranked] : [...ranked, ...rest]
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
