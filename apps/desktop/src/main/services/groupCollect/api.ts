// src/main/services/groupCollect/api.ts
//
// 群成员建档泵的"通电"层之一：ingest 的真实实现（POST 到后端 /api/group-members/batch）
// 与 sort=stale 排序页的真实实现（GET 后端 /api/group-members/groups）。
//
// 本文件刻意只依赖 @shared，不引入 msgBridge / state/session——后者在主进程运行时有
// 扩展名缺失的导入链，node --test 解析不了。依赖运行时的接线（createGroupDispatch /
// runGroupBuild）放到 dispatch.ts，避免把单测也拖进那条链。

import type { GroupCollectApi, IngestPayload, StaleGroupPage } from './engine.ts'

// 与 msgApi.ts 同源：后端默认落地在 8180。token 同样只取 accessToken，不进页、不进渲染层（C2）。
const DEFAULT_API_BASE = 'http://localhost:8180'

export interface GroupCollectApiOptions {
  token: () => string | null
  apiBase?: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

/** 后端 PageResult 的 JSON 形状（records / total / page / pageSize），这里只取前两个。 */
interface PageEnvelope<T> {
  records?: T[] | null
  total?: number
}

/** 群列表行：排序页只需要 chatKey，其余列（title / lastCoverage / …）一概不取。 */
interface GroupKeyRow {
  chatKey?: string | null
}

/**
 * ingest 的真实实现。POST 到后端 `POST /api/group-members/batch`。
 *
 * 合同要点（对照 GroupMemberBatchDTO）：
 * - 三段（groups / snapshot / events）各自独立、互不要求，所以空段一律传 null 而非 []——后端按
 *   null 判断"这一轮没带这段"，传 [] 会被当成"带了一段但为空"，语义不同。
 * - platform 不从请求体取：后端按 accountId 反查 platform_account.platform_type，客户端说了不算。
 * - 返回 {reason, reconciled}：界面据此决定是否提示"本次未做退群判定"（spec §8）。
 *
 * call 返回 null = 失败（非 2xx / 信封非 0 / 网络错）。ingest 抛错会被 engine 记成 failed、
 * 并留到下一轮重试（snapshot 已拿到但没落库，last_snapshot_at 没动，重试安全）。
 */
export function createGroupCollectApi(opts: GroupCollectApiOptions): GroupCollectApi {
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 8_000

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    const token = opts.token()
    if (!token) return null
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) return null
      const env = (await res.json()) as Envelope<T>
      return env.code === 0 && env.data !== undefined ? env.data : null
    } catch {
      return null
    }
  }

  /** GET 版：读口的失败口径与 call 一致（null = 非 2xx / 信封非 0 / 网络错 / 没 token）。 */
  async function get<T>(path: string): Promise<T | null> {
    const token = opts.token()
    if (!token) return null
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) return null
      const env = (await res.json()) as Envelope<T>
      return env.code === 0 && env.data !== undefined ? env.data : null
    } catch {
      return null
    }
  }

  return {
    async ingest(payload: IngestPayload) {
      const data = await call<{ reconciled?: boolean; reason?: string }>('/api/group-members/batch', {
        accountId: payload.accountId,
        groups: payload.groups ?? null,
        snapshot: payload.snapshot ?? null,
        events: payload.events ?? null
      })
      if (!data) throw new Error('group-members/batch 失败或后端不可达')
      return { reconciled: data.reconciled, reason: data.reason }
    },

    /**
     * sort=stale 排序页的真实实现。GET 到后端 `GET /api/group-members/groups`，只取 chatKey。
     *
     * 合同要点（对照 GroupMemberQueryService.pageGroups）：
     * - 次序由后端给出（未建档最前，其余按上次成功快照从旧到新），客户端**原样收下、不重排**——
     *   位置即 rank，客户端再排一次就会把 ISNULL 那一列的语义丢掉。
     * - size 直接用调用方给的（泵传 MAX_GROUPS_PER_BUILD=200，与后端的
     *   `Math.min(Math.max(1,size),200)` 上限同值，所以第 1 页覆盖得住一整轮的队列）。
     * - total 是**筛选后的总行数**，不是本次给回的条数：泵靠它区分"这一页就是全集"与"后面还有"。
     *   缺失时按给回的条数算——那是保守方向，宁可当成全集多排几个未建档的，也不要把已建档的顶到前面。
     * - 剔掉没有可用 chatKey 的行：空串与缺键行会冒充"这一群已登记"，把未建档的挤到后面去。
     *
     * 抛错（非 2xx / 信封非 0 / 网络错 / 没 token）由 engine 捕获并退化成桥次序：排序是优化，不是判定。
     */
    async staleGroups(accountId: number, size: number): Promise<StaleGroupPage> {
      const data = await get<PageEnvelope<GroupKeyRow>>(
        `/api/group-members/groups?accountId=${accountId}&sort=stale&page=1&size=${size}`
      )
      if (!data) throw new Error('group-members/groups?sort=stale 失败或后端不可达')
      const keys = (data.records ?? [])
        .map((row) => (row ? row.chatKey : undefined))
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
      return { keys, total: typeof data.total === 'number' ? data.total : keys.length }
    }
  }
}
