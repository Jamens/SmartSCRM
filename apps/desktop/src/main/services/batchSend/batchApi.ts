// src/main/services/batchSend/batchApi.ts
import type { BatchDetail, BatchProgress, BatchRecallBlocked, BatchTask } from '../../../shared/batchSend.ts'

export type Fetcher = (path: string, init: RequestInit) => Promise<Response>

interface Envelope<T> { code: number; message?: string; data?: T }

export interface ReportItem {
  detailId: number
  localId?: string
  sendStatus: string
  errorCode?: string
  errorDetail?: string
  msgKey?: string
  sentAtEpochSec?: number
}

export interface RecallTarget { detailId: number; accountId: number; chatKey: string; msgKey: string }
/** 被挡下的那一条就是 shared 的那一份形状（Task 15 的折叠区从 IPC 一直读到它）。 */
export interface RecallPlan { eligible: RecallTarget[]; rejected: BatchRecallBlocked[] }
export interface RecallReportItem { detailId: number; recalled: boolean; detail?: string }
export interface Page<T> { records: T[]; total: number; page: number; pageSize: number }

export interface BatchApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }

// 返回类型不写在这里：`BatchApi = ReturnType<typeof createBatchApi>` 是 Task 11/12 的口径，
// 而 `: BatchApi` 会自引用循环。同形的 `createMsgApi` 挂着同一条既有 error，这里用仓库惯例的
// 行级豁免补齐 `--quiet` 闸门，不改 brief 的任何行为。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createBatchApi(opts: BatchApiOptions) {
  // 诊断通道自己不能把这一跳弄挂：宿主传进来的 `onError` 一旦抛，本来只是"这一跳没成"的调用
  // 会变成抛到采集/发送链上，而全文件"返回成功与否、不抛"的那条口径就是靠这里兜住。
  const note = (where: string, e: unknown): void => {
    try {
      opts.onError?.(where, e)
    } catch {
      /* 宿主的日志实现挂了：吞掉，让这一跳照常塌成 null/0 */
    }
  }

  /**
   * 三种「这一跳没成」的形状都要落到 `onError`，因为塌成 null 之后调用方只剩一个值可读：
   * - 非 2xx（409 状态迁移非法 / 40404 任务不属本租户 / 网关 5xx）
   * - 200 但信封 `code !== 0` 或缺 `data`
   * - `fetcher` 直接抛（后端没起 / 断网）
   * 少报任何一种，Task 11 的心跳泵就只能把"后端拒了"和"后端根本没起来"当成同一件事处理——
   * 而它对该不该停泵的判断正好取决于这两者的区别。
   */
  async function call<T>(path: string, init: RequestInit): Promise<T | null> {
    try {
      const res = await opts.fetcher(path, init)
      if (!res.ok) {
        note(path, new Error(`HTTP ${res.status}`))
        return null
      }
      const env = (await res.json()) as Envelope<T>
      if (env.code !== 0 || env.data === undefined) {
        // 两种塌法分开点名：`code=0 但缺 data` 说的是后端形状变了，和"业务拒了"是两回事。
        note(path, new Error(env.code !== 0 ? `信封 code=${env.code}` : '信封 code=0 但 data 缺失'))
        return null
      }
      return env.data
    } catch (e) {
      note(path, e)
      return null
    }
  }

  // 运行面四跳与 reports 的出参就是 `BatchProgress` 那四列，所以直接 call<BatchProgress> 带上类型，
  // 而不是先取 unknown 再 cast：会被 cast 掉的恰好是这几跳——后端在这里回 40902/40404 时，
  // `call` 塌成 null 是有语义的（状态机拒了 / 任务不属于本租户），糊成 unknown 就没人知道 null 从哪来。
  const postProgress = (path: string, body?: unknown): Promise<BatchProgress | null> =>
    call<BatchProgress>(path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })

  return {
    start: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/start`),
    pause: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/pause`),
    resume: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/resume`),
    cancel: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/cancel`),
    task: (taskId: number) => call<BatchTask>(`/api/batch-send/tasks/${taskId}`, { method: 'GET' }),
    details: (taskId: number, page: number, size: number) =>
      call<Page<BatchDetail>>(`/api/batch-send/tasks/${taskId}/details?page=${page}&size=${size}`,
        { method: 'GET' }),
    /** 心跳只关心"命中没有"：0 = 任务已不在 running，调用方据此停泵。 */
    async heartbeat(taskId: number): Promise<number> {
      const data = await call<{ updated?: number }>(`/api/batch-send/tasks/${taskId}/heartbeat`,
        { method: 'POST' })
      return data?.updated ?? 0
    },
    reports: (taskId: number, items: ReportItem[], allHalted: boolean) =>
      postProgress(`/api/batch-send/tasks/${taskId}/reports`, { items, allHalted }),
    /**
     * 三态返回，与 `postProgress` 的「宿主塌成 null 表示这一跳没成」同一条口径——不许再造第二种信号：
     * - `null` = 这一跳没成：`call` 的三种塌法（非 2xx 的 40902/40404、信封 `code !== 0`、`fetcher` 抛）全落这里；
     * - `0`    = 打到了，这个任务确实没有 failed 行；
     * - `N`    = 复位了 N 条。
     * `0` 与 `null` 必须分开：渲染层据此决定是走「这一跳没成」那条红色失败通道、还是陈述「没有可重发的」。
     * 塌成同一个 `0`，详情页就会在后端根本没接住时对用户的数据下一句假话——正是这次要拆掉的歧义。
     * 只回复位条数：R11 那次「done/error → paused」的唤醒结果由渲染层随后 GET 任务拿到，
     * 这里不把 status 穿两层 IPC 再穿一次——同一条链上出现两个"任务现在是什么状态"的读数来源，
     * 而其中一个可能是上一跳的旧值。
     * detailIds 省略或空数组 = 整批复位；带 = 只复位勾选的那几条（spec §7 的单条重发）。
     */
    async retryFailed(taskId: number, detailIds?: number[]): Promise<number | null> {
      const data = await call<{ reset?: number }>(`/api/batch-send/tasks/${taskId}/retry-failed`,
        detailIds?.length
          ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }
          : { method: 'POST' })
      // `data === null`（这一跳没成）与 `data.reset` 缺失（信封形状变了）都塌 null；真打到的 0 原样回 0。
      return data?.reset ?? null
    },
    recall: (taskId: number, detailIds: number[]) =>
      call<RecallPlan>(`/api/batch-send/tasks/${taskId}/recall`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }),
    async recallReports(taskId: number, items: RecallReportItem[]): Promise<number> {
      const data = await call<{ settled?: number }>(`/api/batch-send/tasks/${taskId}/recall-reports`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) })
      return data?.settled ?? 0
    },
    reconcile: () => call<{ pausedTasks: number; markedUnknown: number; markedRecallFailed: number }>(
      '/api/batch-send/reconcile', { method: 'POST' })
  }
}

export type BatchApi = ReturnType<typeof createBatchApi>
