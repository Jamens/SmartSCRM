import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export interface LabelVO {
  id: number
  groupId: number
  name: string
  color: string | null
  sort: number
  useCustomerCount: number
}

export interface LabelGroupVO {
  id: number
  name: string
  color: string | null
  selectType: number
  sort: number
  labels: LabelVO[]
}

export interface CustomerVO {
  id: number
  platformType: number
  openId: string
  nickname: string | null
  avatar: string | null
  phone: string | null
  email: string | null
  country: string | null
  sex: number
  remark: string | null
  vipOpenId: string | null
  vipNickname: string | null
  firstSeenAt: string | null
  lastContactAt: string | null
  createdAt: string
  labels: LabelVO[]
}

export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerEditInput {
  nickname: string | null
  sex: number
  country: string | null
  email: string | null
  remark: string | null
}

export interface CustomerFilters {
  keyword?: string
  platformType?: number | null
  country?: string
  labelIds?: number[]
  page?: number
  pageSize?: number
}

const CUSTOMERS_KEY = ['customers'] as const
const LABEL_TREE_KEY = ['label-groups'] as const

function toQuery(filters: CustomerFilters): string {
  const params = new URLSearchParams()
  if (filters.keyword) params.set('keyword', filters.keyword)
  if (filters.platformType != null) params.set('platformType', String(filters.platformType))
  if (filters.country) params.set('country', filters.country)
  filters.labelIds?.forEach((id) => params.append('labelIds', String(id)))
  params.set('page', String(filters.page ?? 1))
  params.set('pageSize', String(filters.pageSize ?? 20))
  return params.toString()
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, filters],
    queryFn: () => http.get<PageResult<CustomerVO>>(`/api/customers?${toQuery(filters)}`)
  })
}

export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'detail', id],
    queryFn: () => http.get<CustomerVO>(`/api/customers/${id}`),
    enabled: id != null
  })
}

export function useLabelTree() {
  return useQuery({
    queryKey: LABEL_TREE_KEY,
    queryFn: () => http.get<LabelGroupVO[]>('/api/label-groups')
  })
}

function useInvalidateCustomers() {
  const qc = useQueryClient()
  return (): void => {
    void qc.invalidateQueries({ queryKey: CUSTOMERS_KEY })
  }
}

export function useUpdateCustomer() {
  const invalidate = useInvalidateCustomers()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CustomerEditInput }) =>
      http.put<CustomerVO>(`/api/customers/${id}`, input),
    onSuccess: invalidate
  })
}

export function useSetCustomerLabels() {
  const invalidate = useInvalidateCustomers()
  return useMutation({
    mutationFn: ({ id, labelIds }: { id: number; labelIds: number[] }) =>
      http.put<CustomerVO>(`/api/customers/${id}/labels`, { labelIds }),
    onSuccess: invalidate
  })
}

export function useDeleteCustomer() {
  const invalidate = useInvalidateCustomers()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/customers/${id}`),
    onSuccess: invalidate
  })
}
