/**
 * A6 自动更新（检查+通知）的渲染层这一段。
 *
 * 更新源是**自托管可配**的（`AppSettings.updateManifestUrl`，默认空 = 不外连）。检查与下载
 * 都只经 preload 的 `scrm.app` 桥；判定逻辑在 `@shared/update`（有单测）。本版**不安装**，
 * 下载只落主进程 downloads 目录并回一个路径。
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { UpdateVerdict } from '@shared/update'

const SOURCE_KEY = ['update', 'source'] as const

/** 读当前更新源（一次会话里不会自己变，除非用户改）。 */
export function useUpdateSource(): { url: string; loading: boolean } {
  const q = useQuery({
    queryKey: SOURCE_KEY,
    queryFn: async () => {
      const s = await window.scrm?.settings.get()
      return { updateManifestUrl: s?.updateManifestUrl ?? '' }
    },
    staleTime: Infinity
  })
  return { url: q.data?.updateManifestUrl ?? '', loading: q.isPending }
}

/** 保存更新源（空串 = 关掉检查）。 */
export function useSaveUpdateSource(): UseMutationResult<void, Error, string, unknown> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (url: string) => {
      await window.scrm?.settings.set({ updateManifestUrl: url })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SOURCE_KEY })
    }
  })
}

/** 检查更新（未配源 ⇒ 主进程直接 disabled，不发网络请求）。 */
export function useCheckForUpdate(): UseMutationResult<UpdateVerdict | null, Error, void, unknown> {
  return useMutation({
    mutationFn: async () => (await window.scrm?.app.checkForUpdate()) ?? null
  })
}

/** 下载更新包到本地目录（不安装），返回落盘路径。 */
export function useDownloadUpdate(): UseMutationResult<string | null, Error, string, unknown> {
  return useMutation({
    mutationFn: async (downloadUrl: string) => (await window.scrm?.app.downloadUpdate(downloadUrl)) ?? null
  })
}
