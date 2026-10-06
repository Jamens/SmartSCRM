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

/**
 * 发送前的即时判定（非 hook，供 `useSendText.send` 在漏斗里直接 await）。
 * 匹配口径全在后端 `SensitiveWordService.match`（唯一来源），这里只发一次请求取回命中词。
 * 判定本身出错（后端不可达等）时**放行**（fail-open）——风控是旁路，不该因为它抖动就把
 * 所有回复都堵死；要改成 fail-closed 只需在这里把 catch 改成抛。
 */
export async function checkSensitiveWordsNow(text: string): Promise<string[]> {
  const hits = await http.post<string[]>('/api/sensitive-words/check', { text })
  return Array.isArray(hits) ? hits : []
}
