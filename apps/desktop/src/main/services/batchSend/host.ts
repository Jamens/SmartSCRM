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
import type { BatchDetail, BatchStateEvent } from '../../../shared/batchSend'

/** 心跳周期：15 s（spec §5），比后端 60 s 陈旧线短，一次丢两拍才被判死。 */
const HEARTBEAT_MS = 15_000
/** 演练出料口的模拟耗时（spec §11.4：先取 200 ms，只影响观感）。 */
const DRY_RUN_MS = 200

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const api = createBatchApi({
  fetcher: (path, init) => authedFetch(path, init),
  onError: (where, e) => console.warn(`[batch] ${where}`, e)
})
const running = new Map<number, { engine: BatchEngine; timer: NodeJS.Timeout }>()

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
  if (running.has(taskId)) return { started: true }        // 同一个任务只允许一条泵在飞
  const task = await api.task(taskId)
  // 引擎不裁决、也不发起迁移：谁把任务变成 running 是渲染层点「开始」那一次 batch:start 的事。
  if (!task || task.status !== 'running') return { started: false }
  const details: BatchDetail[] = []
  for (let page = 1; ; page++) {
    const res = await api.details(taskId, page, 200)
    if (!res) break
    details.push(...res.records)
    if (details.length >= res.total || res.records.length === 0) break
  }
  const engine = new BatchEngine({
    api, dispatch: task.dryRun ? dryDispatch : realDispatch, viewIdOf,
    sleep, rand: Math.random, now: () => Date.now(),
    log: (where, e) => console.warn(`[batch] task=${taskId} ${where}`, e)
  })
  // timer 先占位再建：setInterval 的回调可能在 engine 进 map 之前就跑到（心跳与泵同时起步）。
  const timer = setInterval(() => void tick(taskId), HEARTBEAT_MS)
  timer.unref()
  running.set(taskId, { engine, timer })
  void engine.start(task, details).then(() => finish(taskId), (e: unknown) => {
    console.error(`[batch] task=${taskId} 泵逃出来的异常`, e)
    finish(taskId)
  })
  return { started: true }
}

/** 心跳 + 顺带广播：15 s 一跳，比每跳都发一次吵得要轻，也比"只在收尾发"有用得多。 */
async function tick(taskId: number): Promise<void> {
  const entry = running.get(taskId)
  if (!entry) return
  await entry.engine.flushBacklog()
  const updated = await api.heartbeat(taskId)
  // updated === 0：任务已不在 running（被暂停/取消/结清），再投料就是对着不该跑的东西投料。
  if (updated === 0) {
    stopEngine(taskId)
    return
  }
  const task = await api.task(taskId)
  if (task) broadcastState({ taskId, status: task.status, totalCount: task.totalCount, sentCount: task.sentCount, failCount: task.failCount })
}

async function finish(taskId: number): Promise<void> {
  stopEngine(taskId)
  const task = await api.task(taskId)
  if (task) broadcastState({ taskId, status: task.status, totalCount: task.totalCount, sentCount: task.sentCount, failCount: task.failCount })
}

function stopEngine(taskId: number): void {
  const entry = running.get(taskId)
  if (!entry) return
  // 顺序不能反：先撤 timer 再 stop 再从 map 摘，反了会有一个在途心跳在摘掉之后重新排一个 timer。
  clearInterval(entry.timer)
  entry.engine.stop()
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
