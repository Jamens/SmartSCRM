// src/renderer/src/api/sensitiveWords.ts
//
// A8 敏感词风控（本地词库）的取数与变更出口。设置页那张卡只调这里的 hooks。
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { http } from '@/lib/http'

export interface SensitiveWordVO {
  id: number
  word: string
  category: string | null
  enabled: boolean
  createdAt: string
}

const KEY = ['sensitive-words'] as const

export function useSensitiveWords(): UseQueryResult<SensitiveWordVO[], Error> {
  return useQuery({
    queryKey: KEY,
    queryFn: () => http.get<SensitiveWordVO[]>('/api/sensitive-words')
  })
}

export function useCreateSensitiveWord(): UseMutationResult<
  SensitiveWordVO,
  Error,
  { word: string; category?: string | null },
  unknown
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input) => http.post<SensitiveWordVO>('/api/sensitive-words', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    }
  })
}

export function useToggleSensitiveWord(): UseMutationResult<
  void,
  Error,
  { id: number; enabled: boolean },
  unknown
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }) => http.put<void>(`/api/sensitive-words/${id}`, { enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    }
  })
}

export function useDeleteSensitiveWord(): UseMutationResult<void, Error, number, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => http.del<void>(`/api/sensitive-words/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    }
  })
}

/** 命中检测：给定文本，返回命中的敏感词数组（空 = 未命中）。 */
export function useCheckSensitiveWord(): UseMutationResult<string[], Error, string, unknown> {
  return useMutation({
    mutationFn: (text) => http.post<string[]>('/api/sensitive-words/check', { text })
  })
}
