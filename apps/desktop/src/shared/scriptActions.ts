/**
 * B8 炒群引擎的纯规则（渲染层 / 驱动 / 后端口径共用，配 node --test）。
 *
 * 放 shared 的理由：动作词表、**断点推进**（nextStep）、failover 切号这三样是"只有一份才对"
 * 的判定——前后端各算一次必然漂移。
 */

/** 动作类型 + 每项的默认参数 + 是否需要目标（群/成员）。词表会扩，只增不改语义。 */
export interface ScriptActionDef {
  type: string
  label: string
  /** 该动作作用在群（true）还是成员（false）。 */
  onGroup: boolean
  /** 默认参数（话术引用 key、条数等）。 */
  defaults: Record<string, unknown>
}

export const SCRIPT_ACTIONS: Record<string, ScriptActionDef> = {
  post_message: { type: 'post_message', label: '群发言', onGroup: true, defaults: { materialId: null } },
  dm_member: { type: 'dm_member', label: '私聊成员', onGroup: false, defaults: { maxPerRound: 5 } },
  react: { type: 'react', label: '表情回应', onGroup: true, defaults: { emoji: '👍' } },
  join_group: { type: 'join_group', label: '进群（接 B18）', onGroup: true, defaults: {} },
  kick_member: { type: 'kick_member', label: '踢人（接 B19）', onGroup: false, defaults: {} }
}

export const ACTION_TYPES = Object.keys(SCRIPT_ACTIONS)

/** 步骤执行状态（与后端 script_task_step.status 同一词表）。 */
export type StepStatus = 'pending' | 'sending' | 'success' | 'failed' | 'skipped'

/** 任务状态（与 batch-send 同一词表）。 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

/**
 * 断点推进：给定该任务**全部**步骤的有序状态，返回下一个该跑/该补的 seq；
 * 全 success/skipped 或无 pending → 返回 null（一轮跑完，交给 loop 重置）。
 *
 * 口径：跳过 sending（正在跑不算待补）；failed 不自动重试（人工 retry-failed 才回到 pending，
 * 与 batch-send 的 unknown 永远不复位同理——避免风控动作被自动重复触发）。
 */
export function nextStep(statuses: (StepStatus | null | undefined)[]): number | null {
  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i]
    if (s == null || s === 'pending') return i
  }
  return null
}

/**
 * failover：当前账号在 ordered 里，失败切下一个；用尽返回 null（task 判 error）。
 * 切号**不重置断点**——这里只给下一个账号，断点由调用方保留。
 */
export function failoverAccount(accountIds: (number | null | undefined)[], currentIdx: number): number | null {
  for (let i = Math.max(0, currentIdx) + 1; i < accountIds.length; i++) {
    const id = accountIds[i]
    if (id != null) return id
  }
  return null
}
