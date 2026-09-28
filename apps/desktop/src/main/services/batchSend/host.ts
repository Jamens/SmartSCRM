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
import type { BatchDetail, BatchStateEvent, BatchTask } from '../../../shared/batchSend'

/** 心跳周期：15 s（spec §5），比后端 60 s 陈旧线短，一次丢两拍才被判死。 */
const HEARTBEAT_MS = 15_000
/**
 * 连着四拍（= 60 s）打不到后端才停泵。这个数就是后端自己的 `STALE_SECONDS`
 * （`BatchSendService.java:58`）——它认定这条泵已经死了的那一刻，泵才自己收。
 * 单拍为 0 就停是不行的：`heartbeat` 把「后端明确说这一行不在 running」和「这一跳根本没打到
 * 后端」（`batchApi` 折成同一个 0，spec:141 有意如此）混在一起，一次 15 s 的网络抖动就会
 * 把泵连同它的上报积压一起扔掉，而积压正是为后端不可达准备的。
 * 界面点暂停/取消那一侧不受这条影响：`batch:pause`/`batch:cancel` 的处理器直接 `stopEngine`。
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

/** 真发：localId 用引擎给的那一个——回执要靠它与明细行对齐（Task 9 的归属登记）。 */
const realDispatch: Dispatch = async (d: BatchDetail, _viewId: string, localId: string): Promise<SendOutcome> => {
  const receipt = await sendText({ accountId: d.accountId, chatKey: d.chatKey, text: d.body, localId })
  return { ok: receipt.ok, msgKey: receipt.msgKey, error: receipt.error, detail: receipt.detail }
}

const recallDispatch: RecallDispatch = async (t: RecallTarget): Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }> => {
  const r = await recallText({ accountId: t.accountId, chatKey: t.chatKey, msgKey: t.msgKey, localId: `r${t.detailId}` })
  return { ok: r.ok, isRevoked: r.isRevoked, detail: r.detail }
}

async function runTask(taskId: number): Promise<{ started: boolean }> {
  // 占位要在第一个 await 之前同步落表：`running.has` 与真正建泵之间隔着 `api.task` 和整段翻页
  // 拉取（20 000 条明细 = 100 跳 HTTP），那个窗口里第二次 runTask 会读到"没人在飞"，
  // 于是同一个 detailId 有两个投料者——群发最贵的一种事故就是同一条消息发出去两遍。
  // 占位格还有个附带用处：开场期间来的 pause/cancel 能在表里找到它并摘掉，下面两处复查据此止步。
  if (running.has(taskId)) return { started: true }
  running.set(taskId, { engine: null, timer: null, misses: 0, beating: false })
  const task = await api.task(taskId)
  // 引擎不裁决、也不发起迁移：谁把任务变成 running 是渲染层点「开始」那一次 batch:start 的事。
  if (!task || task.status !== 'running') {
    running.delete(taskId)
    return { started: false }
  }
  const details: BatchDetail[] = []
  for (let page = 1; ; page++) {
    const res = await api.details(taskId, page, 200)
    if (!res) break
    details.push(...res.records)
    if (details.length >= res.total || res.records.length === 0) break
  }
  if (!running.has(taskId)) return { started: false }
  const engine = new BatchEngine({
    api, dispatch: task.dryRun ? dryDispatch : realDispatch, viewIdOf,
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
  return { started: true }
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
  // 应用一起来就先把上一次崩掉的现场结清：先 unknown 后 paused 的顺序在后端（R4）。
  void api.reconcile().then((r) => {
    if (r && (r.pausedTasks || r.markedUnknown)) console.log(`[batch] reconcile paused=${r.pausedTasks} unknown=${r.markedUnknown}`)
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
  ipcMain.handle('batch:start', async (_e, taskId: number) => {
    const task = await api.start(taskId)
    if (task?.status === 'running') await runTask(taskId)
    return task
  })
  ipcMain.handle('batch:pause', async (_e, taskId: number) => {
    const task = await api.pause(taskId)
    stopEngine(taskId)
    return task
  })
  ipcMain.handle('batch:resume', async (_e, taskId: number) => {
    const task = await api.resume(taskId)
    if (task?.status === 'running') await runTask(taskId)
    return task
  })
  ipcMain.handle('batch:cancel', async (_e, taskId: number) => {
    // 先停泵再打后端：反过来会让泵在 cancel 落地前多投几条。
    stopEngine(taskId)
    return api.cancel(taskId)
  })
  ipcMain.handle('batch:run', (_e, taskId: number) => runTask(taskId))
  // 重发：detailIds 省略＝整批，带＝单条（R11）。同一跳端点，两种粒度只差 body 里那个数组有没有。
  ipcMain.handle('batch:retry-failed', (_e, taskId: number, detailIds?: number[]) =>
    api.retryFailed(taskId, detailIds))
  // 撤回：清单在后端判（Task 5），这里只把 eligible 逐条交给页内出料口，结清走 recallReports。
  ipcMain.handle('batch:recall', async (_e, taskId: number, detailIds: number[]) => {
    const plan = await api.recall(taskId, detailIds)
    if (!plan) return { eligible: 0, blocked: 0 }
    for (const t of plan.eligible) {
      // 账号没有可用视图（掉线 / 未挂桥）也要结清：后端已经把这条推成 recalling，
      // 静默 continue 会让它永远卡在 recalling，界面上看不出"为什么没撤"。
      if (!viewIdOf(t.accountId)) {
        await api.recallReports(taskId, [{ detailId: t.detailId, recalled: false, detail: '账号当前没有可用视图' }])
        continue
      }
      // 一条一结清：撤回的成败只由 isRevoked 判（Task 10），后端据此把 recall_status 落成 recalled 或 recall_failed。
      const r = await recallDispatch(t)
      await api.recallReports(taskId, [{ detailId: t.detailId, recalled: r.ok && r.isRevoked === true, detail: r.detail }])
    }
    return { eligible: plan.eligible.length, blocked: plan.rejected.length }
  })
}
