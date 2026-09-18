import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type ReplyItemType = 1 | 2 | 3 // text | image | business-card

export interface QuickReplyItemVO {
  id: number
  type: ReplyItemType
  content: string | null
  materialId: number | null
  mediaUrl: string | null
  cardName: string | null
  cardPhone: string | null
  sort: number
}

export interface QuickReplyVO {
  id: number
  groupId: number
  title: string
  shortcut: string | null
  sort: number
  useCount: number
  items: QuickReplyItemVO[]
  createdAt: string
}

export interface QuickReplyGroupVO {
  id: number
  name: string
  sort: number
  replyCount: number
}

export interface QuickReplyItemInput {
  type: ReplyItemType
  content?: string | null
  materialId?: number | null
  mediaUrl?: string | null
  cardName?: string | null
  cardPhone?: string | null
  sort?: number
}

export interface QuickReplyInput {
  title: string
  groupId: number
  shortcut?: string | null
  sort?: number
  items: QuickReplyItemInput[]
}

const GROUPS_KEY = ['quick-reply-groups'] as const
const REPLIES_KEY = ['quick-replies'] as const

function toQuery(groupId?: number | null, keyword?: string): string {
  const params = new URLSearchParams()
  if (groupId != null) params.set('groupId', String(groupId))
  if (keyword) params.set('keyword', keyword)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useQuickReplyGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => http.get<QuickReplyGroupVO[]>('/api/quick-reply-groups')
  })
}

export function useQuickReplies(groupId: number | null, keyword?: string) {
  return useQuery({
    queryKey: [...REPLIES_KEY, { groupId, keyword }],
    queryFn: () => http.get<QuickReplyVO[]>(`/api/quick-replies${toQuery(groupId, keyword)}`)
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (): void => {
    void qc.invalidateQueries({ queryKey: REPLIES_KEY })
    void qc.invalidateQueries({ queryKey: GROUPS_KEY })
  }
}

export function useCreateQuickReplyGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; sort?: number }) => http.post('/api/quick-reply-groups', input),
    onSuccess: invalidate
  })
}

export function useUpdateQuickReplyGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: { name: string; sort?: number } }) =>
      http.put(`/api/quick-reply-groups/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteQuickReplyGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/quick-reply-groups/${id}`),
    onSuccess: invalidate
  })
}

export function useCreateQuickReply() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: QuickReplyInput) => http.post<QuickReplyVO>('/api/quick-replies', input),
    onSuccess: invalidate
  })
}

export function useUpdateQuickReply() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: QuickReplyInput }) =>
      http.put<QuickReplyVO>(`/api/quick-replies/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteQuickReply() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/quick-replies/${id}`),
    onSuccess: invalidate
  })
}

/** Fire-and-forget usage counter bump; returns fresh reply. */
export function useRecordQuickReplyUse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.post<QuickReplyVO>(`/api/quick-replies/${id}/use`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: REPLIES_KEY })
  })
}
