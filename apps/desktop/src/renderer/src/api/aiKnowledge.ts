// src/renderer/src/api/aiKnowledge.ts
//
// B28 渲染层的**唯一取数/变更出口**：知识库三栏、文档管线、AI 人设、养号设置、接管台。
// 组件不裸调 http（与 customers/groupMembers 同一纪律）。所有端点都接 knowledge:read/write
// 或 message:read 判定（A16），未授权时后端 403。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'

// ---------- 类型 ----------

export interface AiRoleVO { id: number; name: string; prompt: string | null; enabled: boolean; sort: number }
export interface AiCategoryVO { id: number; name: string; sort: number }
export interface KnowledgeQaVO {
  id: number; roleId: number | null; categoryId: number | null; question: string; answer: string
  source: string; docId: number | null; chunkId: number | null; enabled: boolean
}
export interface KnowledgeDocVO {
  id: number; name: string; sourceType: string; status: string; charCount: number; chunkCount: number
}
export interface KnowledgeChunkVO {
  id: number; docId: number; seq: number; content: string; charCount: number; derived: boolean
}
export interface AiPersonaVO {
  id: number; roleId: number | null; name: string; tone: string | null; prompt: string | null
  template: string | null; enabled: boolean
}
export interface AiNurtureVO {
  dailyLimit: number; activeRatio: number; quietHours: string | null; recommend: string
}
/** 助手草稿（未落库） */
export interface PersonaDraft { template: string; name: string; tone: string; prompt: string }
/** 接管台会话（TakeoverService.queue 的形状，前端只用到这些） */
export interface TakeoverQueueItem {
  id: number; chatKey: string; platform: string; title: string | null
  handlingStatus: string; waitTakeoverAt: string | null; transferReason: string | null
}

const QK = { roles: ['ai','roles'], cats: ['ai','categories'], qa: ['ai','qa'],
  docs: ['ai','docs'], personas: ['ai','personas'], nurture: ['ai','nurture'],
  queue: ['ai','takeover-queue'] } as const

// ---------- 角色 ----------
export function useAiRoles(): UseQueryResult<AiRoleVO[], Error> {
  return useQuery({ queryKey: QK.roles, queryFn: () => http.get<AiRoleVO[]>('/api/ai-roles') })
}
export function useRoleMutations(): {
  create: UseMutationResult<AiRoleVO, Error, { name: string; prompt?: string | null }, unknown>
  update: UseMutationResult<AiRoleVO, Error, { id: number; patch: Record<string, unknown> }, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.roles }); void qc.invalidateQueries({ queryKey: QK.qa }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<AiRoleVO>('/api/ai-roles', b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, patch }) => http.put<AiRoleVO>(`/api/ai-roles/${id}`, patch), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/ai-roles/${id}`), onSuccess: inv })
  }
}

// ---------- 分类 ----------
export function useAiCategories(): UseQueryResult<AiCategoryVO[], Error> {
  return useQuery({ queryKey: QK.cats, queryFn: () => http.get<AiCategoryVO[]>('/api/ai-categories') })
}
export function useCategoryMutations(): {
  create: UseMutationResult<AiCategoryVO, Error, { name: string; sort?: number }, unknown>
  update: UseMutationResult<AiCategoryVO, Error, { id: number; patch: Record<string, unknown> }, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.cats }); void qc.invalidateQueries({ queryKey: QK.qa }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<AiCategoryVO>('/api/ai-categories', b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, patch }) => http.put<AiCategoryVO>(`/api/ai-categories/${id}`, patch), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/ai-categories/${id}`), onSuccess: inv })
  }
}

// ---------- QA ----------
export function useKnowledgeQa(filters?: { roleId?: number | null; categoryId?: number | null }): UseQueryResult<KnowledgeQaVO[], Error> {
  const q = new URLSearchParams()
  if (filters?.roleId) q.set('roleId', String(filters.roleId))
  if (filters?.categoryId) q.set('categoryId', String(filters.categoryId))
  const qs = q.toString()
  return useQuery({ queryKey: [...QK.qa, qs], queryFn: () => http.get<KnowledgeQaVO[]>(`/api/knowledge-qa${qs ? `?${qs}` : ''}`) })
}
export function useQaMutations(): {
  create: UseMutationResult<KnowledgeQaVO, Error, { question: string; answer: string; roleId?: number | null; categoryId?: number | null }, unknown>
  createDerived: UseMutationResult<KnowledgeQaVO, Error, { chunkId: number; question: string; answer: string }, unknown>
  update: UseMutationResult<KnowledgeQaVO, Error, { id: number; patch: Record<string, unknown> }, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.qa }); void qc.invalidateQueries({ queryKey: QK.docs }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<KnowledgeQaVO>('/api/knowledge-qa', b), onSuccess: inv }),
    createDerived: useMutation({ mutationFn: ({ chunkId, ...b }) => http.post<KnowledgeQaVO>(`/api/knowledge-qa/derived?chunkId=${chunkId}`, b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, patch }) => http.put<KnowledgeQaVO>(`/api/knowledge-qa/${id}`, patch), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/knowledge-qa/${id}`), onSuccess: inv })
  }
}

// ---------- 文档管线 ----------
export function useKnowledgeDocs(): UseQueryResult<KnowledgeDocVO[], Error> {
  return useQuery({ queryKey: QK.docs, queryFn: () => http.get<KnowledgeDocVO[]>('/api/knowledge-docs') })
}
export function useDocChunks(docId: number | null): UseQueryResult<KnowledgeChunkVO[], Error> {
  return useQuery({
    queryKey: [...QK.docs, 'chunks', docId],
    queryFn: () => http.get<KnowledgeChunkVO[]>(`/api/knowledge-docs/${docId}/chunks`),
    enabled: docId != null
  })
}
export function useDocMutations(): {
  create: UseMutationResult<KnowledgeDocVO, Error, { name: string; content: string; sourceType?: string }, unknown>
  parse: UseMutationResult<KnowledgeDocVO, Error, number, unknown>
  disable: UseMutationResult<KnowledgeDocVO, Error, number, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.docs }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<KnowledgeDocVO>('/api/knowledge-docs', b), onSuccess: inv }),
    parse: useMutation({ mutationFn: (id) => http.post<KnowledgeDocVO>(`/api/knowledge-docs/${id}/parse`), onSuccess: inv }),
    disable: useMutation({ mutationFn: (id) => http.post<KnowledgeDocVO>(`/api/knowledge-docs/${id}/disable`), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/knowledge-docs/${id}`), onSuccess: inv })
  }
}

// ---------- 人设 ----------
export function useAiPersonas(): UseQueryResult<AiPersonaVO[], Error> {
  return useQuery({ queryKey: QK.personas, queryFn: () => http.get<AiPersonaVO[]>('/api/ai-personas') })
}
export function usePersonaMutations(): {
  create: UseMutationResult<AiPersonaVO, Error, { name: string; roleId?: number | null; tone?: string | null; prompt?: string | null; template?: string | null }, unknown>
  update: UseMutationResult<AiPersonaVO, Error, { id: number; patch: Record<string, unknown> }, unknown>
  remove: UseMutationResult<void, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.personas }) }
  return {
    create: useMutation({ mutationFn: (b) => http.post<AiPersonaVO>('/api/ai-personas', b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, patch }) => http.put<AiPersonaVO>(`/api/ai-personas/${id}`, patch), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id) => http.del<void>(`/api/ai-personas/${id}`), onSuccess: inv })
  }
}
/** 人设助手：按语气产草稿（只返回不落库）。 */
export function useGeneratePersona(): UseMutationResult<PersonaDraft | null, Error, string, unknown> {
  return useMutation({ mutationFn: async (tone) => (await http.post<PersonaDraft>(`/api/ai-personas/generate?tone=${encodeURIComponent(tone)}`)) })
}

// ---------- 养号设置 ----------
export function useAiNurture(): UseQueryResult<AiNurtureVO, Error> {
  return useQuery({ queryKey: QK.nurture, queryFn: () => http.get<AiNurtureVO>('/api/ai-nurture') })
}
export function useSaveNurture(): UseMutationResult<AiNurtureVO, Error, Partial<AiNurtureVO>, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch) => http.put<AiNurtureVO>('/api/ai-nurture', patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: QK.nurture }) }
  })
}

// ---------- 接管台 ----------
export function useTakeoverQueue(): UseQueryResult<TakeoverQueueItem[], Error> {
  return useQuery({ queryKey: QK.queue, queryFn: () => http.get<TakeoverQueueItem[]>('/api/conversations/takeover-queue'), refetchInterval: 15_000 })
}
export function useTakeoverActions(): {
  takeover: UseMutationResult<unknown, Error, number, unknown>
  resumeAi: UseMutationResult<unknown, Error, number, unknown>
} {
  const qc = useQueryClient()
  const inv = (): void => { void qc.invalidateQueries({ queryKey: QK.queue }) }
  return {
    takeover: useMutation({ mutationFn: (id) => http.post(`/api/conversations/${id}/takeover`), onSuccess: inv }),
    resumeAi: useMutation({ mutationFn: (id) => http.post(`/api/conversations/${id}/resume-ai`), onSuccess: inv })
  }
}
