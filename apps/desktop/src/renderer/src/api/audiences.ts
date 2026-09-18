import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { CustomerVO, PageResult } from './customers'

export interface AudienceVO {
  id: number
  name: string
  platformType: number | null
  keyword: string | null
  tagIds: number[]
  customerCount: number
  createdAt: string
}

export interface AudienceInput {
  name: string
  platformType?: number | null
  keyword?: string | null
  tagIds: number[]
}

const AUDIENCES_KEY = ['audiences'] as const

export function useAudiences() {
  return useQuery({
    queryKey: AUDIENCES_KEY,
    queryFn: () => http.get<AudienceVO[]>('/api/audiences')
  })
}

export function useAudienceCustomers(id: number | null, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: [...AUDIENCES_KEY, 'customers', id, page, pageSize],
    queryFn: () =>
      http.get<PageResult<CustomerVO>>(`/api/audiences/${id}/customers?page=${page}&pageSize=${pageSize}`),
    enabled: id != null
  })
}

function useInvalidateAudiences() {
  const qc = useQueryClient()
  return (): void => {
    void qc.invalidateQueries({ queryKey: AUDIENCES_KEY })
  }
}

export function useCreateAudience() {
  const invalidate = useInvalidateAudiences()
  return useMutation({
    mutationFn: (input: AudienceInput) => http.post<AudienceVO>('/api/audiences', input),
    onSuccess: invalidate
  })
}

export function useUpdateAudience() {
  const invalidate = useInvalidateAudiences()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AudienceInput }) =>
      http.put<AudienceVO>(`/api/audiences/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteAudience() {
  const invalidate = useInvalidateAudiences()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/audiences/${id}`),
    onSuccess: invalidate
  })
}
