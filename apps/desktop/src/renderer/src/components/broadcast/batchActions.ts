import type { BatchTask, BatchTaskStatus } from '@shared/batchSend'
import type { BatchDetailVO } from '@/api/batchSend'

export type BatchAction = 'start' | 'pause' | 'resume' | 'cancel'

/**
 * 这张表只决定**按钮出不出现**，合法性仍由后端 40902 裁决；
 * 它与后端 `SOURCES_OF` 是同一规则的两处写法，改一边要看另一边。
 */
export const ACTIONS: Record<BatchTaskStatus, BatchAction[]> = {
  pending: ['start', 'cancel'],
  running: ['pause', 'cancel'],
  paused: ['resume', 'cancel'],
  done: [],
  error: [],
  cancelled: []
}

/**
 * 文案表与 `ACTIONS` 同住：列表（Task 14）与任务详情（Task 15）显示的是同一批状态与同一批按钮，
 * 各写一份就会在改字时静默分叉。`react-refresh/only-export-components` 是 error 级，
 * 所以它们都不许回到 `BatchTaskList.tsx` / `BatchTaskDetail.tsx` 那种组件文件里。
 */
export const ACTION_LABEL: Record<BatchAction, string> = {
  start: '开始',
  pause: '暂停',
  resume: '继续',
  cancel: '取消'
}

export const STATUS_LABEL: Record<BatchTaskStatus, string> = {
  pending: '待开始',
  running: '发送中',
  paused: '已暂停',
  done: '已完成',
  error: '出错',
  cancelled: '已取消'
}

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost'

export const STATUS_VARIANT: Record<BatchTaskStatus, BadgeVariant> = {
  pending: 'secondary',
  running: 'default',
  paused: 'outline',
  done: 'ghost',
  error: 'destructive',
  cancelled: 'ghost'
}

/** 后端四条判据的镜像：`BatchStatus.recallBlocker` 那三条（非演练 / send_status=success / 有 msg_key）+ 服务层那条「recall_status 不是 none = 已经撤过或正在撤」。只用来禁用 checkbox；筛与点名仍在后端 POST /recall。 */
export function recallEligible(task: BatchTask, row: BatchDetailVO): boolean {
  return !task.dryRun && row.sendStatus === 'success' && !!row.msgKey && row.recallStatus === 'none'
}
