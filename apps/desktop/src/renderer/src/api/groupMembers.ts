// src/renderer/src/api/groupMembers.ts
//
// 群成员（P8/B6）渲染层的**唯一取数出口**。Task 16 的两个组件只调这里的 hook，
// 不许在组件里裸 `http.get('/api/group-members/…')`——查询键散到组件里就会出现
// "两处形状不同 → 两份永不刷新的缓存"（`messages.ts:159-175` 那段注释买来的教训）。

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { http } from '@/lib/http'
import { qs } from '@/api/messages'
import type { PageResult } from '@/api/customers'
import type {
  CoverageReason,
  GroupBuildOutcome,
  GroupEventSource,
  GroupEventType,
  GroupExportResult,
  GroupMemberRole,
  GroupStateEvent
} from '@shared/groupMembers'

export const GROUP_MEMBER_PAGE_SIZE = 50
export const GROUP_EVENT_PAGE_SIZE = 30
const BASE = '/api/group-members'

/**
 * `GET /api/group-members/groups` / `customer/{id}/groups` 的一行。字段后端 `GroupVO` 逐字对上。
 *
 * `lastCoverage` / `lastReconcileReason` 是覆盖率闸落在群行上的两个读数（后端 `chat_group` 的两列，V13）：
 * 前者是最近一次快照判定的覆盖率，**`null` 表示没做过可判定的快照**（首次建档、或这一轮没带快照），
 * 后者是判定结论 `ok | first_build | coverage_too_low | no_snapshot`。两个都可能为 `null`，
 * 界面上「没有读数」与「读数是空串」是两回事，不许折成一回事。
 * 名单页顶栏那句「本次快照人数较上次少 x%，未做退群判定」读的是 `/group/members` 那份 `coverage`/`reason`
 * （同一份落库读数的另一条出口），这两个键是给群行用的。
 */
export interface GroupRowVO {
  chatKey: string
  title: string | null
  platform: string
  participantCount: number
  snapshotCount: number
  inGroupCount: number
  lastSnapshotAt: string | null
  lastEventAt: string | null
  isFinal: boolean
  lastCoverage: number | null
  lastReconcileReason: string | null
}

export interface GroupMemberRowVO {
  chatKey: string
  memberKey: string
  phone: string | null
  displayName: string | null
  roleType: GroupMemberRole
  isInGroup: boolean
  joinCount: number
  latestJoinAt: string | null
  latestLeaveAt: string | null
  exitMethod: string | null
  firstSeenAt: string | null
  lastEventAt: string | null
  snapshotSeenCount: number
  customerId: number | null
  lastMsgAt: string | null
  dayMsgCount: number | null
  msgCount: number | null
}

export interface GroupEventRowVO {
  id: number
  chatKey: string
  groupTitle: string | null
  memberKey: string | null
  actorKey: string | null
  actorName: string | null
  eventType: GroupEventType
  occurredAt: string
  source: GroupEventSource
  rawType: string | null
  rawSubtype: string | null
  bodySnapshot: string | null
}

/**
 * `GET /group/members` 的响应：名单与快照新鲜度**同一份**返回——分两次取会让
 * "名单是一秒前的、闸是三秒前的"这种错位成为可能。
 *
 * `coverage` 是 `number | null`：后端 `Double` 列可空，空即"没有分母可除"（首次建档）。
 * 格式化（一位小数、百分比）归 `lib/groupDisplay.ts`，取数层不碰——读数被取数层改过，
 * 下游再格式化一次就成了二次近似。
 */
export interface MemberPageVO {
  members: PageResult<GroupMemberRowVO>
  coverage: number | null
  reason: CoverageReason
}

/**
 * 名单筛选。`isInGroup` 是 `boolean | undefined` 没有第三种：
 * "只看已退群的人"传 `false`，"全部"档传 **`undefined`**（不是 `''`——`qs` 两种都会丢掉，
 * 但那是巧合，`false` 与 `''` 在类型上是两件事，混用会让人以为空串是"全部"的编码）。
 */
export interface MemberFilters {
  isInGroup?: boolean
  role?: GroupMemberRole | ''
  q?: string
  page?: number
}

export const groupKeys = {
  root: ['group'] as const,
  members: (accountId: number | null, chatKey: string, f: MemberFilters) =>
    ['group', 'members', accountId, chatKey, f] as const,
  events: (accountId: number | null, chatKey: string, eventType: string | '', page: number) =>
    ['group', 'events', accountId, chatKey, eventType, page] as const,
  customerGroups: (accountId: number | null, customerId: number | null) =>
    ['group', 'customer-groups', accountId, customerId] as const
}

/**
 * `size` 不从 `filters` 取而是钉成常量，并作为查询键的隐含维度（键里带 `page`，`size` 由
 * hook 自己拼 URL）。为什么钉死：`messages.ts:159-163` 那条注释写得很清楚——两处数字一旦不同，
 * 订阅的就是另一份永不刷新的缓存，而表现是一行报错都没有。弹层只有一个调用方，钉死比开放更便宜。
 */
export function useGroupMembers(
  accountId: number | null,
  chatKey: string,
  filters: MemberFilters
): UseQueryResult<MemberPageVO, Error> {
  const page = filters.page ?? 1
  return useQuery({
    queryKey: groupKeys.members(accountId, chatKey, { ...filters, page }),
    queryFn: () =>
      http.get<MemberPageVO>(
        `${BASE}/group/members${qs({
          accountId,
          chatKey,
          isInGroup: filters.isInGroup,
          role: filters.role || undefined,
          q: filters.q,
          page,
          size: GROUP_MEMBER_PAGE_SIZE
        })}`
      ),
    enabled: accountId != null && chatKey !== ''
  })
}

export function useGroupEvents(
  accountId: number | null,
  chatKey: string,
  eventType: string | '',
  page = 1
): UseQueryResult<PageResult<GroupEventRowVO>, Error> {
  return useQuery({
    queryKey: groupKeys.events(accountId, chatKey, eventType, page),
    queryFn: () =>
      http.get<PageResult<GroupEventRowVO>>(
        `${BASE}/group/events${qs({
          accountId,
          chatKey,
          eventType: eventType || undefined,
          page,
          size: GROUP_EVENT_PAGE_SIZE
        })}`
      ),
    enabled: accountId != null && chatKey !== ''
  })
}

export function useCustomerGroups(
  accountId: number | null,
  customerId: number | null
): UseQueryResult<GroupRowVO[], Error> {
  return useQuery({
    queryKey: groupKeys.customerGroups(accountId, customerId),
    // `accountId` 照传：后端 8b ④ 落地后它就是账号收窄的那一维（R16/R40 不许跨账号混读）。
    // 在那之前后端会忽略这个参数，所以查询键仍把它算进去——落地当天不用改这里，也不会
    // 出现"两个账号共用一份缓存"的过渡态。
    queryFn: () => http.get<GroupRowVO[]>(`${BASE}/customer/${customerId}/groups${qs({ accountId })}`),
    enabled: accountId != null && customerId != null
  })
}

/**
 * 触发一轮建档。`pending` 来自本地 mutation 而不是广播：
 * `window.scrm.group.build()` 的 promise 在整轮跑完才回，而广播 `running`/`settled`
 * 是扇出的第二个信号。两个都用会导致"按钮点了没反应"与"按钮一直灰"两种相反的错法。
 * 这里选 mutation 作按钮态（它是这一次点击的回执，归因清楚），广播只用作缓存失效。
 */
export function useGroupBuild(): {
  build: (req: { accountId: number; chatKey?: string }) => void
  pending: boolean
  outcome: GroupBuildOutcome | null
} {
  const [outcome, setOutcome] = useState<GroupBuildOutcome | null>(null)
  // 单数键（R49）：`group:build` 的契约是 `{ accountId, chatKey? }`，"只补这一群"就传一个键。
  // IPC 是 JSON，多余或拼错的键会被静默忽略——渲染层与主进程两处各一种拼法不会编译报错，
  // 症状是"刷新成员"按下去没有任何反应。所以这一形状在三处（preload / ipc / 这里）必须逐字一致。
  const m = useMutation({
    // `?? null` 不是防御性写法：`window.scrm` 是可选面（`preload/index.d.ts` 里 `scrm?`），
    // preload 没挂上时这里就是 undefined，而"宿主没接上"与"取数没成"是两种失败，必须分开。
    mutationFn: async (req: {
      accountId: number
      chatKey?: string
    }): Promise<GroupBuildOutcome | null> => (await window.scrm?.group.build(req)) ?? null,
    onSuccess: (r) => setOutcome(r ?? null)
  })
  return {
    build: (req: { accountId: number; chatKey?: string }) => void m.mutate(req),
    pending: m.isPending,
    outcome
  }
}

export function useGroupExport(): {
  exportRows: (req: { accountId: number; chatKeys: string[] }) => void
  pending: boolean
  result: GroupExportResult | null
} {
  const [result, setResult] = useState<GroupExportResult | null>(null)
  const m = useMutation({
    mutationFn: async (req: {
      accountId: number
      chatKeys: string[]
    }): Promise<GroupExportResult | null> => (await window.scrm?.group.export(req)) ?? null,
    onSuccess: (r) => setResult(r ?? null)
  })
  // null = 宿主没给答案（preload 没挂上 / IPC 那侧 catch 了）。它和 result.reason==='failed' 是两种失败，
  // 前者要说"这个构建里宿主没接上"，后者才说"取数/写文件没成"。
  return {
    exportRows: (req: { accountId: number; chatKeys: string[] }) => void m.mutate(req),
    pending: m.isPending,
    result
  }
}

/**
 * 挂在 AppLayout：`group:state` 报 `settled` 就整片失效。
 *
 * **不按"某个群来了新事件"失效**：`group:state` 只报一轮建档的在跑 / 结了，而事件攒批器
 * 每 2s 冲一趟——把每一次冲趟都广播一遍会变成"每 2 秒全片失效一次"的轮询风暴。
 * 实时事件只落库，名单要新读数就点顶栏「刷新成员」（§14 不做定时重拉）。
 */
export function useGroupStateInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => {
    return window.scrm?.group.onState((e: GroupStateEvent) => {
      if (e.phase === 'settled') void qc.invalidateQueries({ queryKey: groupKeys.root })
    })
  }, [qc])
}

// `GET /groups` 这一支**本期不导出 hook**：它的读者是建档泵（主进程 `groupCollect/api.ts`）
// 与 Task 14 的契约腿，渲染层没有"选群去操作"的面（spec §14 明列「群运营阶段的选群界面」不做），
// 所以数据层里不放一个没有消费者的 `useGroups`。将来 B9/B10 要选群面时再补，那时候它会有
// 真实的调用方。
