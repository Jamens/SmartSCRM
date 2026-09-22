import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { msgService } from '@/services/msgService'
import { flattenRows, queryKeys, type MessagePageVO, type ThreadRow } from '@/api/messages'
import { mergeTail, pendingKey, settlePending } from '@shared/liveTail'
import type { BridgeState, LiveFrame, MsgStatus } from '@shared/chatTypes'

/**
 * 记录页"双源取数"的另一半：历史读库（`api/messages`），尾巴吃广播（本文件）。
 * 合并的三条规则在 `@shared/liveTail`（Task 7 已单测），这里只做"帧 → 缓存"的搬运，
 * 加两个帧形状带来的特例（状态帧只并状态、同键行的 id/customerId 以库为准）。
 */

/**
 * 一帧 live 的落点，也是 Step 5 要断言的返回值：
 * - `row`：并进了所属会话的尾巴（新消息，补底帧也算）
 * - `status`：只推进了已有行的状态（ack 帧）
 * - `dropped`：ack 找不到对应行——那条消息只存在于库页里，本会话尾巴没这份
 */
export type FrameLanding = 'row' | 'status' | 'dropped'

/**
 * 尾巴缓存 key：一条会话一份，与库页那条 infinite query 分开存。
 * 分开的理由：infinite query 的数据是 `pages[]`，改写它要在 `setQueryData` 里重建整个 `pages`
 * 结构，而 live 帧到的时机可能与正在进行的翻页请求交错（请求回来会整体覆盖尾巴）。分开存之后
 * 翻页覆盖的是"库页"、尾巴独立存活、渲染时合成——这也是 `mergeTail` 规则 2（丢弃比窗口头更旧的行）
 * 能简单成立的前提。
 */
export const tailKey = (accountId: number, chatKey: string) =>
  ['msg', 'tail', accountId, chatKey] as const

/**
 * live 帧 → 行。字段名与 `ThreadRow` 逐一对齐，`mergeTail` 覆盖时是逐字段替换。
 * `id: 0` / `customerId: null` 是"帧里没有这个信息"的占位，不是数据库值——
 * 同键相遇时以库行为准，由 `useThreadRows` 换回真值，否则客户徽标会被盖没。
 * `ts`：帧只带平台秒值（收敛 9 由后端换成本地墙钟），这里乘 1000 只为排序，不参与展示。
 */
export function rowOfLive(frame: LiveFrame): ThreadRow {
  const m = frame.message
  return {
    msgKey: m.msgKey,
    ts: m.msgTimeEpochSec * 1000,
    id: 0,
    accountId: frame.accountId,
    chatKey: m.chatKey,
    direction: m.direction,
    status: m.status,
    source: m.source,
    body: m.body ?? null,
    mediaType: m.mediaType,
    mediaSummary: m.mediaSummary ?? null,
    senderKey: m.senderKey ?? null,
    senderName: m.senderName ?? null,
    customerId: null,
    sendLocalId: m.sendLocalId ?? null
  }
}

/** ack 帧专用：只把 `status` 并到已有行上。 */
function mergeStatus(rows: readonly ThreadRow[], msgKey: string, status: MsgStatus): ThreadRow[] {
  const at = rows.findIndex((r) => r.msgKey === msgKey)
  if (at < 0) return [...rows]
  const out = [...rows]
  out[at] = { ...out[at], status }
  return out
}

/**
 * 列表与统计的失效做 1s 合流。补底一次能推上百帧（Task 10 的 `message` 上报不分实时与补底），
 * 逐帧 invalidate 会把会话列表打成 refetch 风暴；尾巴本身是 setQueryData，不产生请求，无需合流。
 */
const LIST_INVALIDATE_MS = 1000
let listInvalidation: ReturnType<typeof setTimeout> | null = null

function scheduleListInvalidation(qc: QueryClient): void {
  if (listInvalidation) return
  listInvalidation = setTimeout(() => {
    listInvalidation = null
    void qc.invalidateQueries({ queryKey: queryKeys.conversationsRoot })
    void qc.invalidateQueries({ queryKey: queryKeys.statsRoot })
  }, LIST_INVALIDATE_MS)
}

/**
 * 帧 → 缓存。不分"当前会话 / 其它会话"：尾巴按 `tailKey` 各存一份，
 * 切会话时读自己那份，所以从别处切回来也不会丢下刚到的那几条
 * （采集是 500/2s 批量落库，此刻库页里还没有它们）。
 */
export function applyLiveFrame(qc: QueryClient, frame: LiveFrame): FrameLanding {
  const { accountId } = frame
  const { chatKey, msgKey, status } = frame.message
  const key = tailKey(accountId, chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []

  // 状态帧的入口（只推进状态、没有行可插）。今天没有生产者发 `msgTimeEpochSec === 0` 的帧：
  // 主进程 msgBridge/index.ts 的 ack 分支刻意不广播 `msg:live`，因为拼成 NormalizedMessage
  // 会把已有行的 direction / body 改脏。这个分支是 Task 15 那个独立"状态帧"形状到位时的闸，
  // 那时它必须已经在这里——不能让第一帧状态更新去撞 mergeTail：逐字段覆盖会把已有正文抹成 null。
  if (frame.message.msgTimeEpochSec === 0) {
    if (!tail.some((r) => r.msgKey === msgKey)) return 'dropped'
    qc.setQueryData(key, mergeStatus(tail, msgKey, status))
    return 'status'
  }

  qc.setQueryData(key, mergeTail(tail, [rowOfLive(frame)]))
  scheduleListInvalidation(qc)
  return 'row'
}

/**
 * 发送链的回执：乐观气泡换成真实 msgKey。与随后 `msg:live` 的那一帧是同一行——
 * `settlePending` 原地换键，live 帧再按同 msgKey 命中覆盖，不会长出第二行。
 */
export function settleLocalId(
  qc: QueryClient,
  input: { accountId: number; chatKey: string; localId: string; msgKey?: string }
): void {
  const key = tailKey(input.accountId, input.chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []
  qc.setQueryData(
    key,
    // 成功只换键、不改状态：回执只证明平台当场收下了这条，推进阶梯是 ack 的事
    //（把 pending 直接写成 sent，失败的消息也会一路绿到底）。
    // 失败则必须留在窗口里：键保持 `~localId`，只翻状态，让人看得见并能重试。
    input.msgKey
      ? settlePending(tail, input.localId, input.msgKey)
      : settlePending(tail, input.localId, pendingKey(input.localId), { status: 'failed' })
  )
}

/** 控制台探针：dev 下一帧一帧手喂进来验证落点（`applyLiveFrame` 等三个入口），生产构建里整块不存在。 */
interface P6Probe {
  landing: (frame: LiveFrame) => FrameLanding
  settle: (input: { accountId: number; chatKey: string; localId: string; msgKey?: string }) => void
  read: (accountId: number, chatKey: string) => ThreadRow[]
  bridgeStates: () => BridgeState[]
}

/**
 * 全局只挂一次（AppLayout）。桥状态同样进缓存：回复框的禁用态要知道桥在不在（spec §8 离线态）。
 */
export function useLiveTailSync(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const offLive = msgService.onLive((frame) => applyLiveFrame(qc, frame))
    const offState = msgService.onState((states) => qc.setQueryData<BridgeState[]>(queryKeys.bridges, states))
    // 首帧不等广播：切到记录页时桥可能早就 ready 了，而 `msg:state` 是事件不是状态。
    void msgService.bridges().then((states) => qc.setQueryData(queryKeys.bridges, states))
    if (import.meta.env.DEV) {
      // 写在 effect 里而不是渲染期：探针捕获的是"这一次挂载的那份 qc"，渲染期赋值会让第二个
      // 实例（回归脚本临时挂的 root）把指针改到它自己的缓存上，读出来是空的却并不是应用没收到。
      ;(window as unknown as { __p6f?: P6Probe }).__p6f = {
        landing: (frame: LiveFrame) => applyLiveFrame(qc, frame),
        settle: (input: { accountId: number; chatKey: string; localId: string; msgKey?: string }) =>
          settleLocalId(qc, input),
        read: (accountId: number, chatKey: string) => qc.getQueryData<ThreadRow[]>(tailKey(accountId, chatKey)) ?? [],
        bridgeStates: () => qc.getQueryData<BridgeState[]>(queryKeys.bridges) ?? []
      }
    }
    return () => {
      offLive()
      offState()
      if (import.meta.env.DEV) delete (window as unknown as { __p6f?: P6Probe }).__p6f
    }
  }, [qc])
}

/** 回复框与离线提示的数据源：桥不在 ready 就别让人敲字。写入方只有 useLiveTailSync 一处。 */
export function useBridgeOf(accountId: number | null): BridgeState | null {
  // 不写 `initialData: []`：这条缓存条目会被 TanStack 按 gcTime（默认 5 分钟）收走——写它的
  // `useLiveTailSync` 只 setQueryData，不是这条 query 的观察者，没人给它续命。有了 initialData，
  // "条目不存在"就变成"数据是空数组且永远新鲜"（staleTime: Infinity），桥明明 ready 而回复框永久禁用。
  // 同一份脚本对照（tmp/p13-gc2.mjs，removeQueries 后挂本 hook）：留着 initialData 挂 3s 仍是 null，
  // status=success、缓存 0 条、一次请求都没发；去掉后 0.6s 内自己恢复成那条 ready。
  const { data } = useQuery({
    queryKey: queryKeys.bridges,
    queryFn: msgService.bridges,
    staleTime: Infinity,
    enabled: accountId !== null
  })
  if (accountId === null) return null
  return data?.find((s) => s.accountId === accountId && s.ready) ?? null
}

/**
 * 记录页把"库页 + 尾巴"合成一份渲染数组：两条来源只在 msgKey 与 ts 上相遇。
 * 合并方向不能反：`mergeTail(库页, 尾巴)` 让比窗口头更旧的补底帧被规则 2 丢掉
 * （它们本来就在库里，上滑翻页才拿得到）；反过来以尾巴为底会把整页历史当"旧行"扔光。
 */
export function useThreadRows(
  accountId: number | null,
  chatKey: string | null,
  pages: MessagePageVO[] | undefined
): ThreadRow[] {
  const db = flattenRows(pages)
  // 切会话不清尾巴：尾巴按会话各存一份，`-1`/`''` 只是"还没选中会话"时的占位键。会话切回来时
  // 读到同一份尾巴，而库页里那时可能还没有刚到的那几条（采集是 500/2s 批量落库）；未挂载的尾巴
  // 条目由 TanStack 的 `gcTime` 自然回收，不需要手写清理。
  const key = tailKey(accountId ?? -1, chatKey ?? '')
  // `enabled:false` + `initialData:[]` 是"只读缓存、不发起请求"的最小写法：TanStack 没有
  // 只订阅缓存的 hook，`queryFn` 永远不会被调用，所以它返回空数组没有语义。
  // 取 `data` 而不是 v4 的 `.state.data`：v5 的 useQuery 返回值上没有 `state` 这一层。
  const { data: cached } = useQuery({
    queryKey: key,
    queryFn: () => [] as ThreadRow[],
    enabled: false,
    initialData: [] as ThreadRow[]
  })
  const raw = cached ?? []
  // live 帧不知道库内自增 id，也不知道后端匹配到的客户；同键相遇时以库行为准。
  const tail = raw.map((r) => {
    const known = db.find((d) => d.msgKey === r.msgKey)
    return known ? { ...r, id: known.id, customerId: known.customerId } : r
  })
  return mergeTail(db, tail)
}
