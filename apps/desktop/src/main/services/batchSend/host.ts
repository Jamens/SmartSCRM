// src/main/services/batchSend/host.ts
import { ipcMain } from 'electron'
import { getMainWindow } from '../../window/mainWindow'
import { authedFetch } from '../authedFetch'
import { accountOfId } from '../msgBridge/accountDirectory'
import { recallText, sendText } from '../msgBridge'
import { BatchEngine } from './engine'
import { createBatchApi } from './batchApi'
import type { RecallTarget } from './batchApi'
import type { Dispatch, RecallDispatch, SendOutcome } from './engine'
import type {
  BatchDetail, BatchRecallResult, BatchStateEvent, BatchTask, IntervalConfig
} from '../../../shared/batchSend'
import { REPORT_DETAIL_MAX, gapKindFor, pickIntervalSec } from '../../../shared/batchSend'

/** 心跳周期：15 s（spec §5）。四拍打空才停泵，那条线就是下面 `HEARTBEAT_MISS_LIMIT` 的注释。 */
const HEARTBEAT_MS = 15_000
/**
 * 连着四拍（= 60 s）打不到后端才停泵。这个数就是后端自己的 `STALE_SECONDS`
 * （`BatchSendService.java:58`）——它认定这条泵已经死了的那一刻，泵才自己收。
 * 单拍为 0 就停是不行的：`heartbeat` 把「后端明确说这一行不在 running」和「这一跳根本没打到
 * 后端」（`batchApi` 折成同一个 0，spec:141 有意如此）混在一起，一次 15 s 的网络抖动就会
 * 把泵连同它的上报积压一起扔掉，而积压正是为后端不可达准备的。
 * 界面点暂停/取消那一侧不受这条影响：`batch:pause`/`batch:cancel` 的处理器直接 `stopEngine`。
 * 节律口径：撤回循环与发送泵共用同一档 `chat_interval`（spec §5:159，Task 12 I-5 的实现）——
 * 打的是同一条 WA 连接，撤回连发不加节律会让连接侧看到的抖动跟发送连发一样贵。
 */
const HEARTBEAT_MISS_LIMIT = 4
/** 演练出料口的模拟耗时（spec §11.4：先取 200 ms，只影响观感）。 */
const DRY_RUN_MS = 200

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const api = createBatchApi({
  fetcher: (path, init) => authedFetch(path, init),
  onError: (where, e) => console.warn(`[batch] ${where}`, e)
})

/**
 * 一张「taskId → 泵」的表。`engine`/`timer` 可以为 null：那是 `runTask` 在开场之前先占下的格子
 * （见那里的注释），占位格没有任何在飞的东西，只回答"这个 taskId 已经有人在起了"。
 */
interface Pump {
  engine: BatchEngine | null
  timer: NodeJS.Timeout | null
  misses: number
  /** 上一拍心跳还在飞（见 `tick` 开头那句跳过）。 */
  beating: boolean
}
const running = new Map<number, Pump>()

/** 账号→视图的映射只有 accountDirectory 那一份，host 不建第二张表。 */
const viewIdOf = (accountId: number): string | null => accountOfId(accountId)?.viewId ?? null

/** 演练：不碰 `msgBridge`、不碰页面，只按时耗产一条 `dryrun:` 回执（spec §8）。 */
const dryDispatch: Dispatch = async (d: BatchDetail): Promise<SendOutcome> => {
  await sleep(DRY_RUN_MS)
  return { ok: true, msgKey: `dryrun:${d.id}` }
}

/** 真发的桥调用：localId 用引擎给的那一个——回执要靠它与明细行对齐（Task 9 的归属登记）。 */
const sendViaBridge: Dispatch = async (d: BatchDetail, _viewId: string, localId: string): Promise<SendOutcome> => {
  // B17 P5：按钮素材群发链——明细行带的 `buttons` 原样透传给 `sendText`，
  // 后者经主进程→桥→wa-js 渲染原生按钮。普通文本群发 `d.buttons` 为 undefined，不影响原路径。
  const receipt = await sendText({
    accountId: d.accountId,
    chatKey: d.chatKey,
    text: d.body,
    localId,
    buttons: d.buttons
  })
  return { ok: receipt.ok, msgKey: receipt.msgKey, error: receipt.error, detail: receipt.detail }
}

/**
 * A8 群发敏感词：每条**发前**判一次，命中就不发、按 failed 记（errorCode=`SENSITIVE_WORD`，
 * 详情页能看出是风控拦的而不是发送失败）。判定这一跳失败（null）时 fail-open 照发——与渲染层
 * `useSendText` 漏斗同一条口径。批量本身按分钟级间隔慢发，每条一次往返可接受；匹配口径唯一在
 * 后端，主进程不复制一份词表/匹配逻辑（也就没有"两份词表不同步"的问题）。
 */
const makeRealDispatch =
  (check: (text: string) => Promise<string[] | null>): Dispatch =>
  async (d: BatchDetail, viewId: string, localId: string): Promise<SendOutcome> => {
    if (d.body) {
      const hits = await check(d.body)
      if (hits && hits.length > 0) {
        return { ok: false, error: 'SENSITIVE_WORD', detail: `敏感词拦截：${hits.join('、')}` }
      }
    }
    return sendViaBridge(d, viewId, localId)
  }

const recallDispatch: RecallDispatch = async (t: RecallTarget): Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }> => {
  const r = await recallText({ accountId: t.accountId, chatKey: t.chatKey, msgKey: t.msgKey, localId: `r${t.detailId}` })
  return { ok: r.ok, isRevoked: r.isRevoked, detail: r.detail }
}

async function runTask(taskId: number): Promise<{ started: boolean; duplicate: boolean }> {
  // 占位要在第一个 await 之前同步落表：`running.has` 与真正建泵之间隔着 `api.task` 和整段翻页
  // 拉取（20 000 条明细 = 100 跳 HTTP），那个窗口里第二次 runTask 会读到"没人在飞"，
  // 于是同一个 detailId 有两个投料者——群发最贵的一种事故就是同一条消息发出去两遍。
  // 占位格还有个附带用处：开场期间来的 pause/cancel 能在表里找到它并摘掉，下面两处复查据此止步。
  // `duplicate:true` 是给调用方的止损信号：这一格＝有人正在起、或已经起成，回滚会把别人
  // 正在起的任务按停，调用方据此只走 `!started && !duplicate` 那一条回滚路径。engine 是否非 null
  // 决定 `started`——占位格 engine=null 说明那一趟还在翻页/取任务，还没把泵装上；非 null 是已在跑。
  const existing = running.get(taskId)
  if (existing) return { started: existing.engine !== null, duplicate: true }
  running.set(taskId, { engine: null, timer: null, misses: 0, beating: false })
  const task = await api.task(taskId)
  // 引擎不裁决、也不发起迁移：谁把任务变成 running 是渲染层点「开始」那一次 batch:start 的事。
  if (!task || task.status !== 'running') {
    running.delete(taskId)
    return { started: false, duplicate: false }
  }
  const details: BatchDetail[] = []
  for (let page = 1; ; page++) {
    const res = await api.details(taskId, page, 200)
    if (!res) {
      // 翻页塌陷不能当"翻完"：一次 `api.details` 抖动会让剩下的几万行不进队列，泵只跑前缀；
      // 跑完 settle 时 openCount>0，后端既不 done 也不 error，任务停在 running 而没有任何东西在发。
      // 摘掉占位格、返回 `{started:false, duplicate:false}`，让调用方（batch:start/resume 处理器）
      // 走回滚那一条路。这里丢弃的是尚未进入任何引擎的内存清单，没有投料、没有回执，不产生副作用。
      console.warn(`[batch] task=${taskId} 翻页第 ${page} 跳没成，泵未起来`)
      running.delete(taskId)
      return { started: false, duplicate: false }
    }
    details.push(...res.records)
    if (details.length >= res.total || res.records.length === 0) break
  }
  if (!running.has(taskId)) {
    // 有人在翻页窗口里按了暂停/取消并摘掉占位格：这一趟拿到的明细不属于任何在飞的泵，止步；
    // 后端已经被那一跳搬离 running，调用方即使再补一跳 `pause` 也只会撞 40902，无害。
    return { started: false, duplicate: false }
  }
  const engine = new BatchEngine({
    api, dispatch: task.dryRun ? dryDispatch : makeRealDispatch(api.checkSensitive), viewIdOf,
    sleep, rand: Math.random, now: () => Date.now(),
    log: (where, e) => console.warn(`[batch] task=${taskId} ${where}`, e)
  })
  const timer = setInterval(() => void tick(taskId), HEARTBEAT_MS)
  timer.unref()
  // 从上面那句复查到这里落表是同一个同步段：中间不许插 await，否则"被 pause 摘掉的格子
  // 又被这里复活"就成了第三条能起两条泵的路；timer 也在这段里建，止步就不必撤它。
  running.set(taskId, { engine, timer, misses: 0, beating: false })
  void engine.start(task, details).then(() => finish(taskId), (e: unknown) => {
    console.error(`[batch] task=${taskId} 泵逃出来的异常`, e)
    finish(taskId)
  })
  return { started: true, duplicate: false }
}

/** 心跳 + 顺带广播：15 s 一跳，比每跳都发一次吵得要轻，也比"只在收尾发"有用得多。 */
async function tick(taskId: number): Promise<void> {
  const entry = running.get(taskId)
  if (!entry?.engine) return
  // 一拍是可以跑过 15 s 的：flushBacklog 是逐条一跳，每跳的上限是 authedFetch 的 5 s 超时，
  // 积压几十条就足够让 setInterval 把第二条 tick 排进来。两条并发倒同一份积压会把同一批上报
  // 报两遍，倒不动的那段还各塞回一次——同一条结论在积压里就存了两份。上一拍没完就跳过这一拍：
  // 心跳少打一拍不会停泵（要看的是 MISS_LIMIT 那个连续数），也不会让积压变多。
  if (entry.beating) return
  entry.beating = true
  try {
    await entry.engine.flushBacklog()
    const updated = await api.heartbeat(taskId)
    if (updated === 0) {
      // 这一拍没打到/没命中：先记一笔，到 HEARTBEAT_MISS_LIMIT 才认死（两种 0 的分别见那条注释）。
      entry.misses += 1
      if (entry.misses >= HEARTBEAT_MISS_LIMIT) stopEngine(taskId)
      return
    }
    entry.misses = 0
    const task = await api.task(taskId)
    if (task) broadcastTask(task)
  } finally {
    entry.beating = false
  }
}

async function finish(taskId: number): Promise<void> {
  stopEngine(taskId)
  const task = await api.task(taskId)
  if (task) broadcastTask(task)
}

/** 进度只有这一处构造：`tick` 与 `finish` 两个发点读同一份 GET 回来的任务，不各拼一份字面量。 */
function broadcastTask(task: BatchTask): void {
  broadcastState({
    taskId: task.id, status: task.status,
    totalCount: task.totalCount, sentCount: task.sentCount, failCount: task.failCount
  })
}

function stopEngine(taskId: number): void {
  const entry = running.get(taskId)
  if (!entry) return
  // 顺序不能反：先撤 timer 再 stop 再从 map 摘，反了会有一个在途心跳在摘掉之后重新排一个 timer。
  // 两个 null 是给占位格留的：那一段泵还没起步，没什么可停，摘掉就是"这一趟开场作废"。
  if (entry.timer) clearInterval(entry.timer)
  entry.engine?.stop()
  running.delete(taskId)
}

export function startBatchHost(): void {
  // 应用一起来就先把上一次崩掉的现场结清：先 unknown 后 paused 的顺序在后端（R4）；
  // 第三拍（`markedRecallFailed`）结的是孤儿 `recalling` 撤回行，与那两拍读的是不同列，
  // 顺序无关——详见 `BatchSendService.reconcile` 里那条注释。
  void api.reconcile().then((r) => {
    if (r && (r.pausedTasks || r.markedUnknown || r.markedRecallFailed)) {
      console.log(`[batch] reconcile paused=${r.pausedTasks} unknown=${r.markedUnknown} recallFailed=${r.markedRecallFailed}`)
    }
  })
  registerBatchIpc()
}

export async function stopBatchHost(): Promise<void> {
  for (const taskId of [...running.keys()]) stopEngine(taskId)
}

function broadcastState(payload: BatchStateEvent): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('batch:state', payload)
}

export function registerBatchIpc(): void {
  // start 之后顺手 run：渲染层一次 IPC 就能"开始跑"，不需要自己记得再调 run。
  // 泵没起来（翻页塌陷 / `api.task` 塌 null 等 `!started && !duplicate` 那几格）时把刚迁移成功的
  // 任务回滚到 `paused`，再回一次权威 GET：徽标据此说真话「已暂停」。
  // 回滚那一跳自己也塌了 → 返回 `task` 原样：这一格确实会说谎（渲染层拿到 running 会画「发送中」），
  // 但绝不静默返回 null：`BatchTaskDetail.tsx` 的 `null` 那一句是「任务保持原状，没有复位任何行」，
  // 迁移已成功时那是假话，比徽标错一格更坏。
  ipcMain.handle('batch:start', async (_e, taskId: number) => {
    const task = await api.start(taskId)
    if (task?.status === 'running') {
      const r = await runTask(taskId)
      if (!r.started && !r.duplicate) {
        await api.pause(taskId)
        return (await api.task(taskId)) ?? task
      }
    }
    return task
  })
  ipcMain.handle('batch:pause', async (_e, taskId: number) => {
    const task = await api.pause(taskId)
    stopEngine(taskId)
    return task
  })
  ipcMain.handle('batch:resume', async (_e, taskId: number) => {
    const task = await api.resume(taskId)
    if (task?.status === 'running') {
      const r = await runTask(taskId)
      if (!r.started && !r.duplicate) {
        await api.pause(taskId)
        return (await api.task(taskId)) ?? task
      }
    }
    return task
  })
  ipcMain.handle('batch:cancel', async (_e, taskId: number) => {
    // 先停泵再打后端：反过来会让泵在 cancel 落地前多投几条。
    stopEngine(taskId)
    return api.cancel(taskId)
  })
  // 重发：detailIds 省略＝整批，带＝单条（R11）。同一跳端点，两种粒度只差 body 里那个数组有没有。
  ipcMain.handle('batch:retry-failed', (_e, taskId: number, detailIds?: number[]) =>
    api.retryFailed(taskId, detailIds))
  // 撤回：清单在后端判（Task 5），这里只把 eligible 逐条交给页内出料口，结清走 recallReports。
  // 节律与发送走同一档 `chat_interval`（spec §5:159；Task 12 I-5）——打的是同一条 WA 连接，
  // 撤回连发不加节律，抖动成本与发送连发一样贵。
  ipcMain.handle('batch:recall', async (_e, taskId: number, detailIds: number[]): Promise<BatchRecallResult> => {
    const plan = await api.recall(taskId, detailIds)
    if (!plan) return { eligible: 0, blocked: [] }
    // 一条可撤的都没有就别再为节律读一次任务：那一跳除了多一个来回什么都换不到。
    if (!plan.eligible.length) return { eligible: 0, blocked: plan.rejected }
    // 节律档位要读任务；塌了就把节律当 0，宁可不加节律也不打断撤回（后端已把 eligible 推成
    // recalling，静默不撤 = 让它们永远显示「撤回中」，那是 I-2 第三拍要处理的孤儿状态）。
    const cfg: IntervalConfig = await (async () => {
      const t = await api.task(taskId)
      return t
        ? {
            msgMin: t.msgIntervalMin, msgMax: t.msgIntervalMax,
            chatMin: t.chatIntervalMin, chatMax: t.chatIntervalMax
          }
        : { msgMin: 0, msgMax: 0, chatMin: 0, chatMax: 0 }
    })()
    // 第一条不等待：撤回已经落在用户按下之后，第一条再等一档只是让界面像卡住。
    let prev: RecallTarget | null = null
    for (const t of plan.eligible) {
      if (prev) {
        await sleep(pickIntervalSec(gapKindFor(prev, t), cfg, Math.random) * 1000)
      }
      prev = t
      // 逐条 try/catch（I-2）：`recallText` 经 `sendLock.run` 会把页内抛出原样传出来，
      // 一条抛出会打断整批，而后端已把这些行推成 `recalling`——那些行永远显示「撤回中」，
      // 而撤回不可回收。catch 只保证这一条被结清、循环继续下一条；结清那一跳自己也可能失败，
      // 用 `.catch(() => 0)` 吞第二层——那一跳抛了也不许打断循环：剩下的行仍然在 `recalling`，
      // 由 Java 第三拍在下次启动时统一结回 `recall_failed`（I-6 让它们可以再点撤回）。
      try {
        // 账号没有可用视图（掉线 / 未挂桥）也要结清：后端已经把这条推成 recalling，
        // 静默 continue 会让它永远卡在 recalling，界面上看不出"为什么没撤"。
        if (!viewIdOf(t.accountId)) {
          await api.recallReports(taskId, [{
            detailId: t.detailId, recalled: false, detail: '账号当前没有可用视图'
          }]).catch(() => 0)
          continue
        }
        // 一条一结清：撤回的成败只由 isRevoked 判（Task 10），后端据此把 recall_status 落成 recalled 或 recall_failed。
        const r = await recallDispatch(t)
        // 结清载荷也过 REPORT_DETAIL_MAX（I-1）：越界会让这一条 400，永远停在 recalling。
        await api.recallReports(taskId, [{
          detailId: t.detailId,
          recalled: r.ok && r.isRevoked === true,
          detail: r.detail === undefined ? undefined : r.detail.slice(0, REPORT_DETAIL_MAX)
        }]).catch((e: unknown) => {
          console.warn(`[batch] task=${taskId} recall settle detail=${t.detailId}`, e)
          return 0
        })
      } catch (e) {
        // 页内抛出/网络抖动/任何其他单条中断：把这一条按 recall_failed 结掉，console.warn 带
        // taskId 与 detailId 后继续下一条。第二层 `.catch`：结清那一跳也可能抛，抛出会打断循环——
        // 撤回不可回收，宁可让剩下的行留在 `recalling` 等下次启动的第三拍，也不能让它们一起卡死。
        console.warn(`[batch] task=${taskId} recall aborted detail=${t.detailId}`, e)
        await api.recallReports(taskId, [{
          detailId: t.detailId,
          recalled: false,
          detail: '宿主撤回中断'
        }]).catch(() => 0)
      }
    }
    // 挡下的那些后端不写库，`recallDetail` 里永远不会有它们——这一份 reason 列表是唯一的出处。
    return { eligible: plan.eligible.length, blocked: plan.rejected }
  })
}
