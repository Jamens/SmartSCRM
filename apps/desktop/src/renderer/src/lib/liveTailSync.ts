import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { msgService } from '@/services/msgService'
import {
  flattenRows,
  queryKeys,
  rowOfPending,
  type MessagePageVO,
  type ThreadRow
} from '@/api/messages'
import { advanceStatus, furtherStatus, mergeTail, pendingKey, settlePending } from '@shared/liveTail'
import type { BridgeState, LiveFrame, SendReceipt, StatusFrame } from '@shared/chatTypes'
import { ipcFailureText, outcomeOf, sendErrorLogText } from './sendError'

/**
 * 记录页"双源取数"的另一半：历史读库（`api/messages`），尾巴吃广播（本文件）。
 * 合并的三条规则在 `@shared/liveTail`（Task 7 已单测），这里只做"帧 → 缓存"的搬运，
 * 加两个帧形状带来的特例（状态帧只并状态、同键行的 id/customerId/status 以"更可信的一份"为准）。
 *
 * 写尾巴的入口有四个（`applyLiveFrame` / `applyLiveStatus` / `settleLocalId` / `appendPending`），
 * 连同读它的 `useThreadRows` 与发起写的 `useSendText` 都在这一个文件里：它们改的是同一份数组，
 * 散到组件里就一定会出现"谁负责去重"说不清的那天。
 */

/**
 * 一帧 live 消息的落点，也是 A 档探针（`__p6f.landing`）断言的返回值：
 * - `row`：并进了所属会话的尾巴（新消息，补底帧也算）
 * - `dropped`：这一帧没写任何缓存——形状不合格的帧（`chatKey`/`msgKey`/`accountId`
 *   过不了 `isKey`/整数闸）。
 *   ack 那种只推状态、不插行的帧不在这份取值里：它是独立的形状与通道（`StatusFrame` /
 *   `msg:status`），落点由 `applyLiveStatus` 返回的推进条数承担（0 = 一行都没动）。
 */
export type FrameLanding = 'row' | 'dropped'

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

/**
 * 列表与统计的失效做 1s 合流。补底一次能推上百帧（Task 10 的 `message` 上报不分实时与补底），
 * 逐帧 invalidate 会把会话列表打成 refetch 风暴；尾巴本身是 setQueryData，不产生请求，无需合流。
 */
const LIST_INVALIDATE_MS = 1000
// 按 QueryClient 存，不用模块级单例：dev 的回归脚本会临时挂第二个 root，共用一个指针会让后一份
// 缓存收到的帧合流进前一份的 invalidate。也不在卸载时 clear——那一秒内已到的帧已经写进尾巴了，
// 取消会把它们的列表刷新整批丢掉（角标不再 refetch），而 WeakMap 的 pin 上限就是 1s。
const listInvalidations = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

function scheduleListInvalidation(qc: QueryClient): void {
  if (listInvalidations.has(qc)) return
  listInvalidations.set(
    qc,
    setTimeout(() => {
      listInvalidations.delete(qc)
      void qc.invalidateQueries({ queryKey: queryKeys.conversationsRoot })
      void qc.invalidateQueries({ queryKey: queryKeys.statsRoot })
    }, LIST_INVALIDATE_MS)
  )
}

/**
 * `chatKey`/`msgKey` 要进缓存 key 与同键判定，而主进程对 `message` kind 只校 `report.kind`
 * （ack 那条路才先过滤键形状）。坏帧或恶意帧不挡的话，每来一个陌生 chatKey 就长出一条尾巴条目，
 * `msgKey` 缺失还会造出无法命中也永远丢不掉的行。长度闸与后端 `MessageService` 的白名单同量级。
 */
const KEY_MAX_LEN = 128

function isKey(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= KEY_MAX_LEN
}

/**
 * 一帧状态广播最多带多少把键，与主进程 `msgBridge` 的 `STATUS_KEYS_MAX` 是同一个数字的第二份写法
 * （跨主/渲染两个 tsconfig 边界没有共享点，与上面 `KEY_MAX_LEN` 对 `MSG_KEY_MAX` 同理）：
 * 那边按它切片，这边按它拒收，改一处就要改两处。
 */
const STATUS_KEYS_MAX = 200

/**
 * 帧 → 缓存。不分"当前会话 / 其它会话"：尾巴按 `tailKey` 各存一份，
 * 切会话时读自己那份，所以从别处切回来也不会丢下刚到的那几条
 * （采集是 500/2s 批量落库，此刻库页里还没有它们）。
 */
export function applyLiveFrame(qc: QueryClient, frame: LiveFrame): FrameLanding {
  // 类型上 `message` 一定在，运行时它是页内拼出来再一路传上来的：这里按未知形状对待。
  const msg: { chatKey?: unknown; msgKey?: unknown } | undefined = frame.message
  if (!Number.isInteger(frame.accountId) || !isKey(msg?.chatKey) || !isKey(msg?.msgKey))
    return 'dropped'
  const { accountId } = frame
  const { chatKey } = frame.message
  const key = tailKey(accountId, chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []

  // 这里不收只带状态的帧：`mergeTail` 的同键规则是逐字段覆盖，一帧没有 body/direction 的东西
  // 撞进来会把已有行的正文与方向抹成 null。那种帧走 `msg:status` → `applyLiveStatus`。
  qc.setQueryData(key, mergeTail(tail, [rowOfLive(frame)]))
  scheduleListInvalidation(qc)
  return 'row'
}

/**
 * 状态帧 → 缓存：ack 的那一帧（`StatusFrame`，只带键与目标状态）并进尾巴里已有的那几行。
 * 形状闸与 `applyLiveFrame` 同一套——这帧从页内一路传上来，类型不作运行时保证——不合格就返回 0
 * 并且什么都不写。`msgKeys` 超上限也按不合格处理：主进程已按同一个数字切过，还能超长说明它不是
 * 主进程那条路来的，截一半写进去只会留下一批"看上去推进过了"的半截状态。
 * 状态词不校验白名单：阶梯外的值在 `furtherStatus` 两个方向上都推不动，注定是一条 no-op，
 * 与后端 `advanceStatus` 的 `FIELD()` 同一套立场。
 *
 * 不 invalidate 列表与统计：状态不进列表（会话行那些字段没有哪一格会因为一条 ack 改变），
 * 为它打一次 refetch 只是把翻页风暴请回来。
 */
export function applyLiveStatus(qc: QueryClient, frame: StatusFrame): number {
  if (
    !Number.isInteger(frame.accountId) ||
    !isKey(frame.chatKey) ||
    !Array.isArray(frame.msgKeys) ||
    frame.msgKeys.length === 0 ||
    frame.msgKeys.length > STATUS_KEYS_MAX ||
    !frame.msgKeys.every((k) => isKey(k))
  )
    return 0
  const key = tailKey(frame.accountId, frame.chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []
  const { rows, changed } = advanceStatus(tail, frame.msgKeys, frame.status)
  // 命中 0 行也照样写：这一句的判据是"帧合格"，不是"状态动了"——写进去的是字段等值的新数组，
  // 语义没变；不在这儿加 `changed > 0` 的分支，是为了让它以后并第二个字段时不被这里悄悄滤掉。
  qc.setQueryData(key, rows)
  return changed
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
  const bubbleKey = pendingKey(input.localId)
  // 两个键都不在这份尾巴里就什么都不做。走 `settlePending` 的话它会落到
  // `mergeTail(rows, [{ msgKey, ts: 0, ...extra }])` 那一支，而空尾巴时 `mergeTail` 的
  // `oldest` 是 -Infinity——那行没有 body/chatKey/direction 的"幽灵气泡"会被留下：
  // 失败支带着 `status:'failed'` 出现在窗口最顶上，成功支则是一条空行。
  // `settlePending` 自己的注释写的是"气泡已经不在时不新增行"，这条闸才是让那句话成立的地方。
  // 真实键那一行还在（live 帧先到、回执后到）时不拦：命中同键覆盖，ts 由 Math.max 保住。
  const hasBubble = tail.some(
    (r) => r.msgKey === bubbleKey || (input.msgKey !== undefined && r.msgKey === input.msgKey)
  )
  if (!hasBubble) return
  if (!input.msgKey) {
    qc.setQueryData(key, settlePending(tail, input.localId, bubbleKey, { status: 'failed' }))
    return
  }
  qc.setQueryData(
    key,
    // 成功只换键、不改状态：回执只证明平台当场收下了这条，推进阶梯是 ack 的事
    //（把 pending 直接写成 sent，失败的消息也会一路绿到底）。
    // 失败则必须留在窗口里：键保持 `~localId`，只翻状态，让人看得见并能重试。
    settlePending(tail, input.localId, input.msgKey)
  )
}

/**
 * 乐观气泡进尾巴：键是 `pendingKey(localId)`（`~` 前缀），回执或 live 帧到达后换掉。
 * 之后落库的真行按 msgKey 与它合并，界面上始终只有一个节点。
 *
 * 只写尾巴、不碰会话列表：列表的 `lastMsgBody` 等页内那条 `app_send` 的 live 帧到达后再刷
 * （`applyLiveFrame` 会合流失效）。差一两秒，但避免了"点了发送→列表和流各刷新一次"的抖动。
 */
export function appendPending(
  qc: QueryClient,
  input: { accountId: number; chatKey: string; text: string; localId: string }
): void {
  const key = tailKey(input.accountId, input.chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []
  qc.setQueryData(key, mergeTail(tail, [rowOfPending(input)]))
}

/** 控制台探针：dev 下一帧一帧手喂进来验证落点（`applyLiveFrame` 等四个入口），生产构建里整块不存在。 */
interface P6Probe {
  landing: (frame: LiveFrame) => FrameLanding
  /** 手喂一帧状态：返回值就是"这一帧真的推进了几行"，气泡 ⏱→✓→✓✓ 的 A 档断言靠它。 */
  status: (frame: StatusFrame) => number
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
    const offStatus = msgService.onStatus((frame) => applyLiveStatus(qc, frame))
    const offState = msgService.onState((states) =>
      qc.setQueryData<BridgeState[]>(queryKeys.bridges, states)
    )
    // 首帧不等广播：切到记录页时桥可能早就 ready 了，而 `msg:state` 是事件不是状态。
    // catch 是必需的：`ipcMain.handle` 抛出会以 rejected promise 回到这里，不接就是渲染层一条
    // 未处理拒绝。这一条只是"补一次初始状态"，拿不到就等下一次 `msg:state` 广播，不提示。
    void msgService
      .bridges()
      .then((states) => qc.setQueryData(queryKeys.bridges, states))
      .catch(() => undefined)
    if (import.meta.env.DEV) {
      // 写在 effect 里而不是渲染期：探针捕获的是"这一次挂载的那份 qc"，渲染期赋值会让第二个
      // 实例（回归脚本临时挂的 root）把指针改到它自己的缓存上，读出来是空的却并不是应用没收到。
      ;(window as unknown as { __p6f?: P6Probe }).__p6f = {
        landing: (frame: LiveFrame) => applyLiveFrame(qc, frame),
        status: (frame: StatusFrame) => applyLiveStatus(qc, frame),
        settle: (input: { accountId: number; chatKey: string; localId: string; msgKey?: string }) =>
          settleLocalId(qc, input),
        read: (accountId: number, chatKey: string) =>
          qc.getQueryData<ThreadRow[]>(tailKey(accountId, chatKey)) ?? [],
        bridgeStates: () => qc.getQueryData<BridgeState[]>(queryKeys.bridges) ?? []
      }
    }
    return () => {
      offLive()
      offStatus()
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
 * 发送链的渲染层这一段：登记乐观气泡 → 等主进程回执 → 换键。
 * 不乐观翻状态（`ok:true` 只证明平台收下），推进阶梯是 ack 帧的事（Task 13 第 6 行断言）。
 * 回执到文案的那段映射（含四条码归类、`ok:true` 却没 msgKey 怎么办）不在这里，
 * 在 `./sendError`——那份是无 React 依赖的纯函数，`sendError.test.ts` 直接测它。
 *
 * 另一个契约（`ReplyComposer.sendNow` 的那个 catch 的标注全靠它）：**那段 `msgService.send`
 * 的调用不会把 reject 漏给调用方**。主进程 `ipcMain.handle` 抛出时会以 rejected promise 回到
 * 下面那个 catch，在那里就按失败结清（乐观气泡翻 ⚠ + 重试，调用方拿到 `{ok:false}`）。
 * 不接住的话上面那条乐观气泡就永远停在 ⏱（既没有 ⚠ 也没有重试按钮），而调用方的 catch 会把它
 * 报成"译文获取失败"——那是个假原因，用户会去查翻译而不是查桥。
 * 这里只声称 IPC 那一段：`send` 整体仍可能在 try 之外抛（`crypto.randomUUID()`、
 * `appendPending`、`settleLocalId`（它写缓存，`catch` 里那次调用同样在 try 之外）、`outcomeOf`
 * 之前的字段读取），那些抛出去就是调用方的问题了，别把这句注释
 * 读成"这个函数永不 reject"。两处注释互指，改任何一处都要回来改另一处。
 */
export function useSendText(
  accountId: number | null,
  chatKey: string | null
): { send: (text: string) => Promise<{ ok: true } | { ok: false; message: string }> } {
  const qc = useQueryClient()
  return {
    async send(text) {
      if (accountId === null || chatKey === null) return { ok: false, message: '还没选中会话' }
      const localId = crypto.randomUUID()
      appendPending(qc, { accountId, chatKey, text, localId })
      let receipt: SendReceipt
      try {
        receipt = await msgService.send({ accountId, chatKey, text, localId })
      } catch (e) {
        // 见上面那段契约：异常在这里就按失败结清（键留 `~localId`、状态翻 failed），
        // 人能看到并且能重试，并且**不往外抛**，调用方那句"译文获取失败"才只可能是翻译给的。
        // 这一支不加日志：主进程那边抛得比这里有上下文，同一件事记两处只会让人猜哪条是真的。
        settleLocalId(qc, { accountId, chatKey, localId })
        return { ok: false, message: ipcFailureText(e) }
      }
      // ok 但没带 msgKey 时留 `~localId` 不猜键：Task 12 的页内发送一定回 id，
      // 真出现说明上游契约破了，让 Task 19 的端到端把它抓出来，而不是在这里编一个。
      settleLocalId(qc, {
        accountId,
        chatKey,
        localId,
        msgKey: receipt.ok ? receipt.msgKey : undefined
      })
      // 失败回执的 code/detail 只进这一行日志：给人看的仍然是 `outcomeOf` 那句归类文案，
      // 一个字都不许多（detail 是 wa-js 抛出的原文，销售读不懂也不该读）。
      // 只在渲染层控制台，不进 preload、不进注入页（C2/C3）；成功路径不留日志，
      // `ok:true` 却没 msgKey 那一支没有 code/detail 可记，所以同样不记。
      if (!receipt.ok) console.warn('[useSendText]', sendErrorLogText(receipt))
      // 那三段成败判定整体在 `./sendError` 的 `outcomeOf`（含"ok 却没 msgKey 不能报成功"的理由），
      // 那里有它的单测。
      return outcomeOf(receipt)
    }
  }
}

/**
 * 缓存里没有尾巴时的稳定空数组。写它是安全的：`raw.map(...)` 与 `mergeTail` 都产出新数组，
 * 这个引用不会从 `useThreadRows` 逃出去；每次 render 新建一个 `[]` 倒是会让下面的 memo 全部失效。
 */
const NO_ROWS: ThreadRow[] = []

/**
 * 记录页把"库页 + 尾巴"合成一份渲染数组：两条来源只在 msgKey 与 ts 上相遇。
 * 合并方向不能反：`mergeTail(库页, 尾巴)` 让比窗口头更旧的补底帧被规则 2 丢掉
 * （它们本来就在库里，上滑翻页才拿得到）；反过来以尾巴为底会把整页历史当"旧行"扔光。
 * 每一层都 memo：Task 14 的自动滚 effect 依赖 `[rows]`，返回新引用会让它每帧都触发，
 * 而气泡上的 memo 永远命中不了。
 */
export function useThreadRows(
  accountId: number | null,
  chatKey: string | null,
  pages: MessagePageVO[] | undefined
): ThreadRow[] {
  const db = useMemo(() => flattenRows(pages), [pages])
  // 切会话不清尾巴：尾巴按会话各存一份，`-1`/`''` 只是"还没选中会话"时的占位键。会话切回来时
  // 读到同一份尾巴，而库页里那时可能还没有刚到的那几条（采集是 500/2s 批量落库）；未挂载的尾巴
  // 条目由 TanStack 的 `gcTime` 自然回收，不需要手写清理。
  const key = tailKey(accountId ?? -1, chatKey ?? '')
  // `enabled:false` + `initialData:[]` 是"只读缓存、不发起请求"的最小写法：TanStack 没有
  // 只订阅缓存的 hook，`queryFn` 永远不会被调用，所以它返回空数组没有语义。
  // 取 `data` 而不是 v4 的 `.state.data`：v5 的 useQuery 返回值上没有 `state` 这一层。
  const { data: cached } = useQuery({
    queryKey: key,
    queryFn: () => NO_ROWS,
    enabled: false,
    initialData: NO_ROWS
  })
  const raw = cached ?? NO_ROWS
  const tail = useMemo(
    () =>
      raw.map((r) => {
        const known = db.find((d) => d.msgKey === r.msgKey)
        // live 帧不知道库内自增 id，也不知道后端匹配到的客户；同键相遇时以库行为准。
        // status 也必须一起过，而且两个方向都得问（`furtherStatus`）：尾巴那一份由 `msg:status`
        // 的 ack 帧推进、只推它自己已有的行，所以库页既可能更新（尾巴被 `gcTime` 收走过、ack 早于
        // live 帧到达）也可能更旧（库页还是上一次翻页的快照）。按 `mergeTail` 那套"尾巴一定赢"
        // 会把 out 气泡的勾冻在 `pending`，而 Task 14 渲染的就是这个数组，下游修不了。
        return known
          ? {
              ...r,
              id: known.id,
              customerId: known.customerId,
              status: furtherStatus(known.status, r.status)
            }
          : r
      }),
    [raw, db]
  )
  return useMemo(() => mergeTail(db, tail), [db, tail])
}
