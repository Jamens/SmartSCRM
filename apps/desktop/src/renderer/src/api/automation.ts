// src/renderer/src/api/automation.ts
//
// B20 自动化任务面板渲染层出口：总览聚合 + 账号批量关闭/删除。端点接 A16 script:read/write。
// 删除**先停任务再删**（spec §5），后端返回 stoppedTasks；前端删除前再展示预览（二次确认）。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type AutomationKind = 'script' | 'nurture' | 'groupJoin' | 'groupKick'

export interface AutomationAccountRow {
  id: number
  name: string
  platformType: number
  online: boolean
  /** 该账号上在跑的自动化任务数（B9 多账号已展开）。 */
  activeTasks: number
}

export interface AutomationOverview {
  accountsTotal: number
  accountsOnline: number
  tasksTotal: number
  tasksActive: number
  /** 状态 → 计数（跨四类任务）。 */
  byStatus: Record<string, number>
  /** 来源 → 计数：script/nurture/groupJoin/groupKick。 */
  byKind: Partial<Record<AutomationKind, number>>
  accounts: AutomationAccountRow[]
}

export interface AccountsActionResult {
  ok: boolean
  /** 删除时返回：先停掉的任务数。 */
  stoppedTasks?: number
}

export function useAutomationOverview(): ReturnType<typeof useQuery<AutomationOverview, Error>> {
  return useQuery({
    queryKey: ['automation', 'overview'],
    queryFn: () => http.get<AutomationOverview>('/api/automation/overview'),
    refetchInterval: 15_000
  })
}

function useAccountsAction(kind: 'close' | 'delete'): ReturnType<typeof useMutation<AccountsActionResult, Error, number[]>> {
  const qc = useQueryClient()
  const path = kind === 'close' ? '/api/automation/accounts/close' : '/api/automation/accounts/delete'
  return useMutation<AccountsActionResult, Error, number[]>({
    mutationFn: (ids) => http.post<AccountsActionResult>(path, { accountIds: ids }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automation'] })
  })
}

export function useAutomationMutations(): {
  close: ReturnType<typeof useAccountsAction>
  delete: ReturnType<typeof useAccountsAction>
} {
  return { close: useAccountsAction('close'), delete: useAccountsAction('delete') }
}
