// src/main/services/batchSend/batchApi.ts
import type { BatchDetail, BatchProgress, BatchTask } from '../../../shared/batchSend.ts'

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
export interface RecallBlocked { detailId: number; reason: string }
export interface RecallPlan { eligible: RecallTarget[]; rejected: RecallBlocked[] }
export interface RecallReportItem { detailId: number; recalled: boolean; detail?: string }
export interface Page<T> { records: T[]; total: number; page: number; pageSize: number }

export interface BatchApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }

// 返回类型不写在这里：`BatchApi = ReturnType<typeof createBatchApi>` 是 Task 11/12 的口径，
// 而 `: BatchApi` 会自引用循环。同形的 `createMsgApi` 挂着同一条既有 error，这里用仓库惯例的
// 行级豁免补齐 `--quiet` 闸门，不改 brief 的任何行为。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createBatchApi(opts: BatchApiOptions) {
  const note = (where: string, e: unknown): void => opts.onError?.(where, e)

  async function call<T>(path: string, init: RequestInit): Promise<T | null> {
    try {
      const res = await opts.fetcher(path, init)
      if (!res.ok) return null
      const env = (await res.json()) as Envelope<T>
      return env.code === 0 && env.data !== undefined ? env.data : null
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
     * 只回复位条数：R11 那次「done/error → paused」的唤醒结果由渲染层随后 GET 任务拿到，
     * 这里不把 status 穿两层 IPC 再穿一次——同一条链上出现两个"任务现在是什么状态"的读数来源，
     * 而其中一个可能是上一跳的旧值。
     * detailIds 省略或空数组 = 整批复位；带 = 只复位勾选的那几条（spec §7 的单条重发）。
     */
    async retryFailed(taskId: number, detailIds?: number[]): Promise<number> {
      const data = await call<{ reset?: number }>(`/api/batch-send/tasks/${taskId}/retry-failed`,
        detailIds?.length
          ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }
          : { method: 'POST' })
      return data?.reset ?? 0
    },
    recall: (taskId: number, detailIds: number[]) =>
      call<RecallPlan>(`/api/batch-send/tasks/${taskId}/recall`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }),
    async recallReports(taskId: number, items: RecallReportItem[]): Promise<number> {
      const data = await call<{ settled?: number }>(`/api/batch-send/tasks/${taskId}/recall-reports`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) })
      return data?.settled ?? 0
    },
    reconcile: () => call<{ pausedTasks: number; markedUnknown: number }>('/api/batch-send/reconcile',
      { method: 'POST' })
  }
}

export type BatchApi = ReturnType<typeof createBatchApi>
