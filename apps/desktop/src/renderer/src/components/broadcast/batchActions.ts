import type { BatchTaskStatus } from '@shared/batchSend'

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
