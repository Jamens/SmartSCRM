import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type MaterialType = 1 | 2 | 3 | 4 // image | video | audio | file

/**
 * B17 P2 素材归属。与后端 `MaterialScope` 同一套词表：
 * - public：租户内共享（ownerKey 为 null）
 * - personal：只有拥有者本人能用到（ownerKey = app_user.id，由后端强制盖成调用者自己）
 * - contact：绑定某位客户（ownerKey = customer.id），在该客户的会话里出现
 */
export type MaterialOwnerScope = 'public' | 'personal' | 'contact'

export const MATERIAL_SCOPES: MaterialOwnerScope[] = ['public', 'personal', 'contact']

export interface MaterialVO {
  id: number
  groupId: number | null
  type: MaterialType
  name: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
  remark: string | null
  ownerScope: MaterialOwnerScope
  /** personal 时是拥有者 app_user.id，contact 时是 customer.id，public 时为 null。 */
  ownerKey: string | null
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
  ownerScope?: MaterialOwnerScope
  /** 仅 contact 档需要（客户 id）。personal 档由后端取调用者自己，传了也不算。 */
  ownerKey?: string | null
}

export interface MaterialFilters {
  groupId?: number | null
  type?: MaterialType | null
  keyword?: string
  /** 只在可见集内收窄，不能用来看到别人的 personal 素材（后端保证）。 */
  ownerScope?: MaterialOwnerScope | null
  /** 给了才把该客户的 contact 素材并入可见集。 */
  customerId?: number | null
}

const GROUPS_KEY = ['material-groups'] as const
const MATERIALS_KEY = ['materials'] as const

function toQuery(f: MaterialFilters): string {
  const params = new URLSearchParams()
  if (f.groupId != null) params.set('groupId', String(f.groupId))
  if (f.type != null) params.set('type', String(f.type))
  if (f.keyword) params.set('keyword', f.keyword)
  if (f.ownerScope) params.set('ownerScope', f.ownerScope)
  if (f.customerId != null) params.set('customerId', String(f.customerId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useMaterialGroups(): import('@tanstack/react-query').UseQueryResult<
  MaterialGroupVO[],
  Error
> {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => http.get<MaterialGroupVO[]>('/api/material-groups')
  })
}

export function useMaterials(
  filters: MaterialFilters
): import('@tanstack/react-query').UseQueryResult<MaterialVO[], Error> {
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

export function useCreateMaterialGroup(): import('@tanstack/react-query').UseMutationResult<
  unknown,
  Error,
  { name: string; sort?: number },
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; sort?: number }) =>
      http.post('/api/material-groups', input),
    onSuccess: invalidate
  })
}

export function useUpdateMaterialGroup(): import('@tanstack/react-query').UseMutationResult<
  unknown,
  Error,
  { id: number; input: { name: string; sort?: number } },
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: { name: string; sort?: number } }) =>
      http.put(`/api/material-groups/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteMaterialGroup(): import('@tanstack/react-query').UseMutationResult<
  unknown,
  Error,
  number,
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/material-groups/${id}`),
    onSuccess: invalidate
  })
}

export function useCreateMaterial(): import('@tanstack/react-query').UseMutationResult<
  MaterialVO,
  Error,
  MaterialInput,
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: MaterialInput) => http.post<MaterialVO>('/api/materials', input),
    onSuccess: invalidate
  })
}

export function useUpdateMaterial(): import('@tanstack/react-query').UseMutationResult<
  MaterialVO,
  Error,
  { id: number; input: MaterialInput },
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: MaterialInput }) =>
      http.put<MaterialVO>(`/api/materials/${id}`, input),
    onSuccess: invalidate
  })
}

export function useDeleteMaterial(): import('@tanstack/react-query').UseMutationResult<
  unknown,
  Error,
  number,
  unknown
> {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) => http.del(`/api/materials/${id}`),
    onSuccess: invalidate
  })
}

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  1: 'materials.type.image',
  2: 'materials.type.video',
  3: 'materials.type.audio',
  4: 'materials.type.file'
}

export const MATERIAL_SCOPE_LABELS: Record<MaterialOwnerScope, string> = {
  public: 'materials.scope.public',
  personal: 'materials.scope.personal',
  contact: 'materials.scope.contact'
}
