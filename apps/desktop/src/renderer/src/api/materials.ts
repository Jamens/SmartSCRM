import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type MaterialType = 1 | 2 | 3 | 4 // image | video | audio | file

export interface MaterialVO {
  id: number
  groupId: number | null
  type: MaterialType
  name: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
  remark: string | null
  createdAt: string
}

export interface MaterialGroupVO {
  id: number
  name: string
  sort: number
  materialCount: number
}

export interface MaterialInput {
  groupId?: number | null
  type: MaterialType
  name: string
  url: string
  mimeType?: string | null
  sizeBytes?: number | null
  remark?: string | null
}

export interface MaterialFilters {
  groupId?: number | null
  type?: MaterialType | null
  keyword?: string
}

const GROUPS_KEY = ['material-groups'] as const
const MATERIALS_KEY = ['materials'] as const

function toQuery(f: MaterialFilters): string {
  const params = new URLSearchParams()
  if (f.groupId != null) params.set('groupId', String(f.groupId))
  if (f.type != null) params.set('type', String(f.type))
  if (f.keyword) params.set('keyword', f.keyword)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useMaterialGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => http.get<MaterialGroupVO[]>('/api/material-groups')
  })
}

export function useMaterials(filters: MaterialFilters) {
  return useQuery({
    queryKey: [...MATERIALS_KEY, filters],
    queryFn: () => http.get<MaterialVO[]>(`/api/materials${toQuery(filters)}`)
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (): void => {
    void qc.invalidateQueries({ queryKey: MATERIALS_KEY })
    void qc.invalidateQueries({ queryKey: GROUPS_KEY })
  }
}

export function useCreateMaterialGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; sort?: number }) => http.post('/api/material-groups', input),
    onSuccess: invalidate
  })
}

export function useUpdateMaterialGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: { name: string; sort?: number } }) =>
      http.put(`/api/material-groups/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteMaterialGroup() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/material-groups/${id}`),
    onSuccess: invalidate
  })
}

export function useCreateMaterial() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: MaterialInput) => http.post<MaterialVO>('/api/materials', input),
    onSuccess: invalidate
  })
}

export function useUpdateMaterial() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: MaterialInput }) =>
      http.put<MaterialVO>(`/api/materials/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteMaterial() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/materials/${id}`),
    onSuccess: invalidate
  })
}

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  1: '图片',
  2: '视频',
  3: '音频',
  4: '文件'
}
