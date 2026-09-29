import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { PageResult } from './customers'
import type { BatchDetail, BatchProgress, BatchRecallResult, BatchTask } from '@shared/batchSend'

const BATCH_KEY = ['batch'] as const

export type BatchTaskVO = BatchTask
export type BatchDetailVO = BatchDetail

export interface BatchCreateInput {
  name: string
  platform: 'whatsapp'
  dryRun: boolean
  accountIds: number[]
  conversations: { accountId: number; chatKey: string }[]
  contents: string[]
  msgIntervalMin: number
  msgIntervalMax: number
  chatIntervalMin: number
  chatIntervalMax: number
}

export interface BatchCreateVO {
  taskId: number
  rejected: { chatKey: string; accountId: number; reason: string }[]
  totalCount: number
}

/** 一条收件人的寻址：账号 + 会话键（与后端 `BatchRecipientDTO` 同形）。 */
type RecipientRef = { accountId: number; chatKey: string }
type PreviewInput = { conversations: RecipientRef[]; contents: string[] }
type PreviewRow = { chatKey: string; contentIndex: number; body: string }
type PreviewResult = { rows: PreviewRow[]; truncated: boolean }
/** 重发/撤回的入参：`taskId` 定位任务，`detailIds` 定哪几行（重发省略＝整批）。 */
type RetryInput = { taskId: number; detailIds?: number[] }
type RecallInput = { taskId: number; detailIds: number[] }

/**
 * `window.scrm` 在类型上是可选的（preload 没挂上的浏览器调试档），而群发的运行面只有宿主能给。
 * 这里不给静默 no-op 的 fallback：`services/msgService.ts` 那份 fallback 有明确的离线语义
 * （发送一律回 `BRIDGE_OFFLINE`），而"点了开始什么都没发生"会被 UI 当成成功——
 * 对一条会往客户脸上发消息的链，那是最坏的一种假成功。
 */
type BatchHost = NonNullable<Window['scrm']>['batch']

function batchHost(): BatchHost {
  const scrm = window.scrm
  if (!scrm) throw new Error('批量群发需要 Electron 宿主（preload 未挂载）')
  return scrm.batch
}

export function useBatchTasks(status?: string, page = 1, size = 20): UseQueryResult<PageResult<BatchTaskVO>, Error> {
  return useQuery({
    queryKey: [...BATCH_KEY, 'list', status ?? '', page, size],
    queryFn: () =>
      http.get<PageResult<BatchTaskVO>>(
        `/api/batch-send/tasks?page=${page}&size=${size}${status ? `&status=${status}` : ''}`
      )
  })
}

export function useBatchTask(taskId: number | null): UseQueryResult<BatchTaskVO, Error> {
  return useQuery({
    queryKey: [...BATCH_KEY, 'task', taskId],
    queryFn: () => http.get<BatchTaskVO>(`/api/batch-send/tasks/${taskId}`),
    enabled: taskId != null
  })
}

/** 明细的 seq 升序由后端保证（Task 4），这里不再排第二遍。
 *  `refetchIntervalMs`（Task 12 I-4）：任务在 running 时以固定节律刷这一屏；否则传 `false`，让
 *  非 running 状态退回「事件 + GET」那条节律。为什么是节律而不是事件驱动 invalidate 明细：
 *  演练任务 0 秒间隔会一秒发几百个 `batch:state`，那是对本地后端的自 DDoS——明细那一屏要的是"表在动"，
 *  每 N 秒 GET 一次就够；`useBatchLive` 只覆盖任务与列表两个 key，明细不在它的管辖里。
 */
export function useBatchDetails(
  taskId: number | null,
  sendStatus?: string,
  recallStatus?: string,
  page = 1,
  size = 50,
  refetchIntervalMs?: number | false
): UseQueryResult<PageResult<BatchDetailVO>, Error> {
  return useQuery({
    queryKey: [...BATCH_KEY, 'details', taskId, sendStatus ?? '', recallStatus ?? '', page, size],
    queryFn: () =>
      http.get<PageResult<BatchDetailVO>>(
        `/api/batch-send/tasks/${taskId}/details?page=${page}&size=${size}` +
          `${sendStatus ? `&sendStatus=${sendStatus}` : ''}${recallStatus ? `&recallStatus=${recallStatus}` : ''}`
      ),
    enabled: taskId != null,
    ...(refetchIntervalMs === undefined ? {} : { refetchInterval: refetchIntervalMs })
  })
}

export function useCreateBatchTask(): UseMutationResult<BatchCreateVO, Error, BatchCreateInput, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BatchCreateInput) => http.post<BatchCreateVO>('/api/batch-send/tasks', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'list'] })
  })
}

export function useBatchPreview(): UseMutationResult<PreviewResult, Error, PreviewInput, unknown> {
  return useMutation({
    mutationFn: (input: PreviewInput) => http.post<PreviewResult>('/api/batch-send/preview', input)
  })
}

/**
 * 状态迁移不直连 REST：群发的"开始"必须由主进程起泵，所以这一跳走 window.scrm.batch。
 * 四个动作都只回 `BatchProgress | null`（后端 `BatchReportsResultVO` 那四列；宿主塌成 null 表示这一跳没成）。
 * 泵起来后 `runTask` 若翻页/取任务塌陷，宿主会把刚迁移成功的任务回滚到 `paused`，返回一份新的
 * `BatchTask`（结构上是 `BatchProgress` 的超集）——徽标据此说真话「已暂停」。回滚那一跳自己也塌了时
 * 宿主仍返回原样那份 `BatchProgress`（不会给你 `null`），因为渲染层那句 `null` 文案说的是「任务保持原状，
 * 没有复位任何行」，迁移已成功时那是假话。所以 `null` 只出现在 `api.start/pause/resume/cancel` 本身塌的
 * 那一格（后端拒绝、宿主不可达）。
 * `retry-failed` 回的是三态的复位读数（`null` = 这一跳没成 / `0` = 打到了但没 failed 行 / `N` = 复位数），
 * 形状不同，另立一个 `useBatchRetry`：一个 hook 两种返回会让调用方无从判定拿到的是哪个。
 * 这里没有 `run`：起泵是 `batch:start`/`batch:resume` 的处理器自己干的活（`main/services/batchSend/host.ts`
 * 的 `registerBatchIpc`），渲染层再补一跳就会起出两条泵（M2 已把 `batch:run` 那一跳整段拆掉）。
 */
export function useBatchAction(
  action: 'start' | 'pause' | 'resume' | 'cancel'
): UseMutationResult<BatchProgress | null, Error, number, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: number) => batchHost()[action](taskId),
    onSuccess: (_out, taskId) => {
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'task', taskId] })
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'list'] })
    }
  })
}

/** 重发：detailIds 省略＝整批（表头那颗），带＝只这一行（行末那颗）。返回三态复位读数（`null`=这一跳没成 / `0`=没 failed 行 / `N`=复位数），新状态靠下面的 invalidate 重新 GET。 */
export function useBatchRetry(): UseMutationResult<number | null, Error, RetryInput, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, detailIds }: RetryInput) => batchHost().retryFailed(taskId, detailIds),
    onSuccess: (_reset, { taskId }) => {
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'task', taskId] })
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'details', taskId] })
    }
  })
}

/**
 * 撤回的逐条成败不在这条 promise 上：真撤的那几行只看 `isRevoked`，结论文案躺在明细的
 * `recallDetail` 里（撤回结论没有 error 码，R52），所以这里回收明细那一页。
 * `blocked` 却在 promise 上：被挡下的行后端不写库，`recallDetail` 永远不会有它们，
 * 这一份 reason 列表是「这几条为什么没撤」的唯一出处（Task 15 的折叠区读它）。
 */
export function useBatchRecall(): UseMutationResult<BatchRecallResult, Error, RecallInput, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, detailIds }: RecallInput) => batchHost().recall(taskId, detailIds),
    onSuccess: (_out, v) => void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'details', v.taskId] })
  })
}

/**
 * 事件只是加速器：进页面一律 GET 兜底（spec §7），所以这里只顺手并一帧进缓存，不建第二个真值。
 * 并完这一帧就 invalidate 让 GET 覆盖它——`batch:state` 的数字是主进程顺手广播的那一份，
 * 权威读数永远在 `GET /tasks/{id}`（`shared/batchSend.ts` 的 `BatchStateEvent` 注释同一条口径）。
 * 覆盖范围只到 `task` 与 `list` 两个 key：明细那一屏不进这条链——演练任务 0 秒间隔一秒能广播几百个
 * `batch:state`，每一个都 invalidate 明细 = 对本地后端的自 DDoS（Task 12 I-4）。明细的刷新走
 * `useBatchDetails` 的 `refetchIntervalMs` 节律（由 `BatchTaskDetail.tsx` 在 running 时传 2000）。
 */
export function useBatchLive(): void {
  const qc = useQueryClient()
  useEffect(() => {
    return window.scrm?.batch.onState((e) => {
      qc.setQueryData<BatchTaskVO>([...BATCH_KEY, 'task', e.taskId], (prev) =>
        prev
          ? {
              ...prev,
              status: e.status,
              sentCount: e.sentCount,
              failCount: e.failCount,
              totalCount: e.totalCount
            }
          : prev
      )
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'list'] })
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'task', e.taskId] })
    })
  }, [qc])
}
