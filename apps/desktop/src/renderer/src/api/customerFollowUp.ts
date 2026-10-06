// src/renderer/src/api/customerFollowUp.ts
//
// B23 客户跟进记录渲染层出口：跟进记录 CRUD + 标签变更流水查询 + 批量打/撤标签（批量操作条）。
// 端点接 A16 customerfollow:read/write（V46 播种）。
//
// 为什么要有「标签变更流水」这条查询：customer_label 是撤标即删行的关联表，撤完行就没了，
// 只有后端在写入路径落的流水能回答「谁在什么时候给哪个客户打/撤了哪个标签」。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type FollowUpType = 'note' | 'call' | 'email' | 'meeting' | 'other'
export type LabelChangeAction = 'add' | 'remove'

export interface CustomerFollowUp {
  id: number
  tenantId: number
  customerId: number
  type: FollowUpType
  content: string
  /** 下次跟进提醒时间（可为空，统计卡「待跟进」按它算）。 */
  remindAt: string | null
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CustomerLabelChange {
  id: number
  tenantId: number
  customerId: number
  labelId: number
  action: LabelChangeAction
  operator: string | null
  createdAt: string | null
}

export interface FollowUpUpsert {
  customerId: number
  content: string
  type?: FollowUpType
  remindAt?: string | null
}

export function useCustomerFollowUps(
  customerId: number | null
): ReturnType<typeof useQuery<CustomerFollowUp[], Error>> {
  return useQuery({
    queryKey: ['customer-follow-up', 'list', customerId],
    queryFn: () =>
      http.get<CustomerFollowUp[]>(
        customerId == null ? '/api/customer-follow-ups' : `/api/customer-follow-ups?customerId=${customerId}`
      ),
    refetchInterval: 15_000
  })
}

export function useCustomerLabelChanges(
  customerId: number | null
): ReturnType<typeof useQuery<CustomerLabelChange[], Error>> {
  return useQuery({
    queryKey: ['customer-follow-up', 'changes', customerId],
    queryFn: () =>
      http.get<CustomerLabelChange[]>(
        customerId == null
          ? '/api/customer-follow-ups/label-changes'
          : `/api/customer-follow-ups/label-changes?customerId=${customerId}`
      ),
    refetchInterval: 15_000
  })
}

export function useCustomerFollowUpMutations(): {
  create: ReturnType<typeof useMutation<CustomerFollowUp, Error, FollowUpUpsert, unknown>>
  update: ReturnType<typeof useMutation<CustomerFollowUp, Error, { id: number; body: Partial<FollowUpUpsert> }, unknown>>
  remove: ReturnType<typeof useMutation<void, Error, number, unknown>>
} {
  const qc = useQueryClient()
  const inv = (): void => {
    void qc.invalidateQueries({ queryKey: ['customer-follow-up'] })
  }
  return {
    create: useMutation({
      mutationFn: (b) => http.post<CustomerFollowUp>('/api/customer-follow-ups', b),
      onSuccess: inv
    }),
    update: useMutation({
      mutationFn: ({ id, body }) => http.put<CustomerFollowUp>(`/api/customer-follow-ups/${id}`, body),
      onSuccess: inv
    }),
    remove: useMutation({
      mutationFn: (id) => http.del<void>(`/api/customer-follow-ups/${id}`),
      onSuccess: inv
    })
  }
}

/** 批量打/撤标签：改的是客户身上的标签，故连 ['customers'] 与 ['label-groups'] 一起刷。 */
export function useCustomerBatchLabel(): ReturnType<
  typeof useMutation<number, Error, { customerIds: number[]; labelIds: number[]; action: LabelChangeAction }, unknown>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { customerIds: number[]; labelIds: number[]; action: LabelChangeAction }) =>
      http.post<number>('/api/customer-batch/label', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customer-follow-up'] })
      void qc.invalidateQueries({ queryKey: ['customers'] })
      void qc.invalidateQueries({ queryKey: ['label-groups'] })
    }
  })
}
