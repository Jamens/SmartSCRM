import { useMutation, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { LabelGroupVO, LabelVO } from './customers'

export const LABEL_TREE_KEY = ['label-groups'] as const

export interface LabelGroupInput {
  name: string
  color?: string | null
  selectType?: number
  sort?: number
}

export interface LabelInput {
  name: string
  color?: string | null
  sort?: number
}

export type { LabelGroupVO, LabelVO }

function useInvalidateTree() {
  const qc = useQueryClient()
  return (): void => {
    void qc.invalidateQueries({ queryKey: LABEL_TREE_KEY })
    void qc.invalidateQueries({ queryKey: ['customers'] })
  }
}

export function useCreateGroup() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: (input: LabelGroupInput) => http.post('/api/label-groups', input),
    onSuccess: invalidate
  })
}

export function useUpdateGroup() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: LabelGroupInput }) =>
      http.put(`/api/label-groups/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteGroup() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/label-groups/${id}`),
    onSuccess: invalidate
  })
}

export function useCreateLabel() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: ({ groupId, input }: { groupId: number; input: LabelInput }) =>
      http.post<LabelVO>(`/api/label-groups/${groupId}/labels`, input),
    onSuccess: invalidate
  })
}

export function useUpdateLabel() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: LabelInput }) =>
      http.put<LabelVO>(`/api/labels/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteLabel() {
  const invalidate = useInvalidateTree()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/labels/${id}`),
    onSuccess: invalidate
  })
}
