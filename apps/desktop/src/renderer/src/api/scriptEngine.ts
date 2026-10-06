// src/renderer/src/api/scriptEngine.ts
//
// B8 炒群引擎渲染层出口：角色库三级 + 剧本/步骤 + 任务实例。端点接 A16 script:read/write 判定。
// 动作词表从 @shared/scriptActions 取（与后端/驱动同一份），不在这里另抄一份。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'
import { SCRIPT_ACTIONS, ACTION_TYPES } from '@shared/scriptActions'

export { SCRIPT_ACTIONS, ACTION_TYPES }

// ---------- 角色库三级 ----------
export interface RoleCategory { id: number; name: string; sort: number }
export interface ScriptRole { id: number; categoryId: number; name: string; prompt: string | null; enabled: boolean; sort: number }
export interface ActionTpl { id: number; roleId: number; actionType: string; name: string; params: string | null; enabled: boolean }

export function useRoleCategories(): UseQueryResult<RoleCategory[], Error> {
  return useQuery({ queryKey: ['script', 'categories'], queryFn: () => http.get<RoleCategory[]>('/api/script-roles/categories') })
}
export function useRoles(categoryId?: number | null): UseQueryResult<ScriptRole[], Error> {
  const q = categoryId ? `?categoryId=${categoryId}` : ''
  return useQuery({ queryKey: ['script', 'roles', categoryId ?? null], queryFn: () => http.get<ScriptRole[]>(`/api/script-roles${q}`) })
}
export function useActionTpls(roleId?: number | null): UseQueryResult<ActionTpl[], Error> {
  const q = roleId ? `?roleId=${roleId}` : ''
  return useQuery({ queryKey: ['script', 'tpls', roleId ?? null], queryFn: () => http.get<ActionTpl[]>(`/api/script-roles/action-tpls${q}`) })
}

export function useRoleMutations(): {
  createCategory: UseMutationResult<RoleCategory, Error, { name: string; sort?: number }, unknown>
  deleteCategory: UseMutationResult<void, Error, number, unknown>
  createRole: UseMutationResult<ScriptRole, Error, { name: string; categoryId: number; prompt?: string | null }, unknown>
  updateRole: UseMutationResult<ScriptRole, Error, { id: number; patch: Record<string, unknown> }, unknown>
  deleteRole: UseMutationResult<void, Error, number, unknown>
  createTpl: UseMutationResult<ActionTpl, Error, { name: string; actionType: string; roleId: number; params?: string | null }, unknown>
  deleteTpl: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (k: string) => (): void => { void qc.invalidateQueries({ queryKey: ['script', k] }) }
  return {
    createCategory: useMutation({ mutationFn: (b) => http.post<RoleCategory>('/api/script-roles/categories', b), onSuccess: inv('categories') }),
    deleteCategory: useMutation({ mutationFn: (id) => http.del<void>(`/api/script-roles/categories/${id}`), onSuccess: inv('categories') }),
    createRole: useMutation({ mutationFn: (b) => http.post<ScriptRole>('/api/script-roles', b), onSuccess: inv('roles') }),
    updateRole: useMutation({ mutationFn: ({ id, patch }) => http.put<ScriptRole>(`/api/script-roles/${id}`, patch), onSuccess: inv('roles') }),
    deleteRole: useMutation({ mutationFn: (id) => http.del<void>(`/api/script-roles/${id}`), onSuccess: inv('roles') }),
    createTpl: useMutation({ mutationFn: (b) => http.post<ActionTpl>('/api/script-roles/action-tpls', b), onSuccess: inv('tpls') }),
    deleteTpl: useMutation({ mutationFn: (id) => http.del<void>(`/api/script-roles/action-tpls/${id}`), onSuccess: inv('tpls') })
  }
}

// ---------- 剧本 ----------
export interface Playbook { id: number; roleId: number; name: string; enabled: boolean; loopIntervalSec: number; accountIds: string | null }
export interface PlaybookStep { id: number; playbookId: number; seq: number; actionType: string; params: string | null }

export function usePlaybooks(): UseQueryResult<Playbook[], Error> {
  return useQuery({ queryKey: ['script', 'playbooks'], queryFn: () => http.get<Playbook[]>('/api/script-playbooks') })
}
export function usePlaybookSteps(playbookId: number | null): UseQueryResult<PlaybookStep[], Error> {
  return useQuery({
    queryKey: ['script', 'pbsteps', playbookId],
    queryFn: () => http.get<PlaybookStep[]>(`/api/script-playbooks/${playbookId}/steps`),
    enabled: playbookId != null
  })
}
export function usePlaybookMutations(): {
  create: UseMutationResult<Playbook, Error, { name: string; roleId: number; loopIntervalSec?: number; accountIds?: string | null }, unknown>
  update: UseMutationResult<Playbook, Error, { id: number; patch: Record<string, unknown> }, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
  addStep: UseMutationResult<PlaybookStep, Error, { playbookId: number; seq: number; actionType: string }, unknown>
  removeStep: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (k: string) => (): void => { void qc.invalidateQueries({ queryKey: ['script', k] }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<Playbook>('/api/script-playbooks', b), onSuccess: inv('playbooks') }),
    update: useMutation({ mutationFn: ({ id, patch }) => http.put<Playbook>(`/api/script-playbooks/${id}`, patch), onSuccess: inv('playbooks') }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/script-playbooks/${id}`), onSuccess: inv('playbooks') }),
    addStep: useMutation({ mutationFn: ({ playbookId, ...b }) => http.post<PlaybookStep>(`/api/script-playbooks/${playbookId}/steps`, b), onSuccess: inv('pbsteps') }),
    removeStep: useMutation({ mutationFn: (id) => http.del<void>(`/api/script-playbooks/steps/${id}`), onSuccess: inv('pbsteps') })
  }
}

// ---------- 任务实例 ----------
export interface ScriptTask {
  id: number; playbookId: number; accountId: number | null; targetChatKey: string; targetGroupId: string | null
  status: string; currentStep: number; attempts: number; lastError: string | null; nextRunAt: string | null
}
export interface TaskStep {
  id: number; taskId: number; seq: number; actionType: string; status: string; errorDetail: string | null; msgKey: string | null
}

export function useTasks(playbookId?: number | null): UseQueryResult<ScriptTask[], Error> {
  const q = playbookId ? `?playbookId=${playbookId}` : ''
  return useQuery({ queryKey: ['script', 'tasks', playbookId ?? null], queryFn: () => http.get<ScriptTask[]>(`/api/script-tasks${q}`), refetchInterval: 10_000 })
}
export function useTaskSteps(taskId: number | null): UseQueryResult<TaskStep[], Error> {
  return useQuery({
    queryKey: ['script', 'tasksteps', taskId],
    queryFn: () => http.get<TaskStep[]>(`/api/script-tasks/${taskId}/steps`),
    enabled: taskId != null
  })
}
export function useTaskMutations(): {
  start: UseMutationResult<ScriptTask, Error, { playbookId: number; targetChatKey: string }, unknown>
  advance: UseMutationResult<boolean, Error, number, unknown>
  report: UseMutationResult<void, Error, { taskId: number; seq: number; status: string }, unknown>
  cancel: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => {
    void qc.invalidateQueries({ queryKey: ['script', 'tasks'] })
    void qc.invalidateQueries({ queryKey: ['script', 'tasksteps'] })
  }
  return {
    start: useMutation({ mutationFn: (b) => http.post<ScriptTask>('/api/script-tasks', b), onSuccess: inv }),
    advance: useMutation({ mutationFn: (id) => http.post<boolean>(`/api/script-tasks/${id}/advance`), onSuccess: inv }),
    report: useMutation({ mutationFn: ({ taskId, ...b }) => http.post<void>(`/api/script-tasks/${taskId}/report`, b), onSuccess: inv }),
    cancel: useMutation({ mutationFn: (id) => http.post<void>(`/api/script-tasks/${id}/cancel`), onSuccess: inv })
  }
}
