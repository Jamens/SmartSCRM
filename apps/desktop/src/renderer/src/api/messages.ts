import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { http } from '@/lib/http'
import { pendingKey, type TailRow } from '@shared/liveTail'
import type { Direction, MediaType, MsgSource, MsgStatus } from '@shared/chatTypes'
import type { ChatPlatform } from '@shared/chatPlatform'

export interface ConversationVO {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  title: string | null
  isGroup: boolean
  customerId: number | null
  lastMsgTime: string | null
  lastMsgBody: string | null
  unreadCount: number
}

export interface MessageVO {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  msgKey: string
  direction: Direction
  customerId: number | null
  senderKey: string | null
  senderName: string | null
  body: string | null
  mediaType: MediaType
  mediaSummary: string | null
  msgTime: string
  status: MsgStatus
  source: MsgSource
  sendLocalId: string | null
}

export interface ConversationPageVO { records: ConversationVO[]; nextCursor: string | null; hasMore: boolean }
export interface MessagePageVO { records: MessageVO[]; nextCursor: string | null; hasMore: boolean }
export interface SearchHitVO { message: MessageVO; conversationId: number | null; chatTitle: string | null }
export interface MessageSearchVO { records: SearchHitVO[]; nextCursor: string | null; hasMore: boolean }
export interface DayCountVO { day: string; inCount: number; outCount: number }
export interface MessageStatsVO {
  total: number
  inCount: number
  outCount: number
  activeConversations: number
  perDay: DayCountVO[]
}
export interface CustomerTimelineVO {
  messages: MessageVO[]
  conversations: ConversationVO[]
  messageCount: number
  conversationCount: number
}

export interface ConversationQuery {
  accountId: number | null
  platform?: ChatPlatform | null
  q?: string
  size?: number
}

export interface MessageQuery {
  accountId: number | null
  chatKey: string | null
  /** 上滑翻页：上一页的 nextCursor。首屏不传。 */
  before?: string | null
  /**
   * 锚点：把首屏窗口定位到这条消息上（它成为窗口最后一条）。只传库里的行 id，
   * 游标串由后端算——见 Task 4 `aroundPos` 的注释，客户端拼 epoch 会踩时区。
   * 传了它之后，第二页起仍然走 nextCursor（Task 16 的搜索跳转依赖这个组合）。
   */
  around?: number | null
  size?: number
}

export interface SearchQuery {
  q: string
  platform?: ChatPlatform | null
  accountId?: number | null
  direction?: Direction | null
  from?: string | null
  to?: string | null
  customerId?: number | null
  size?: number
}

/** 一处定义、三处消费（hooks / liveTailSync / 失效目标），字符串不重复。 */
export const queryKeys = {
  conversations: (p: ConversationQuery) => ['msg', 'conversations', p] as const,
  messages: (p: MessageQuery) => ['msg', 'messages', p] as const,
  search: (p: SearchQuery, cursor: string | null) => ['msg', 'search', p, cursor] as const,
  stats: (accountId: number | null, days: number) => ['msg', 'stats', accountId, days] as const,
  timeline: (id: number | null, size: number) => ['msg', 'timeline', id, size] as const,
  bridges: ['msg', 'bridges'] as const,
  /** 失效用的前缀：新消息会让整张列表与所有天数的统计同时过期，逐个 days 点名会漏。 */
  conversationsRoot: ['msg', 'conversations'] as const,
  statsRoot: ['msg', 'stats'] as const
}

const qs = (input: Record<string, unknown>): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useConversations(p: ConversationQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(p),
    enabled: p.accountId !== null,
    initialPageParam: null as string | null,
    // 游标分页只能 infinite：offset 型翻页在采集与补底同时发生时会让同一条会话出现在两页里。
    queryFn: ({ pageParam }) =>
      http.get<ConversationPageVO>(`/api/conversations${qs({ ...p, cursor: pageParam })}`),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useMessages(p: MessageQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(p),
    enabled: p.accountId !== null && !!p.chatKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      http.get<MessagePageVO>(
        `/api/messages${qs({
          ...p,
          before: pageParam ?? p.before ?? null,
          // around 只作用于首屏：第二页起 pageParam 就是后端给的 nextCursor，此时还必须带上
          // around 会让每次续翻都被拽回锚点窗口，往上翻不动。qs() 会丢掉 null，所以这里显式覆盖。
          // "是不是首屏"只能按 pageParam 判：v5 的 queryFn 上下文里没有 v4 的 pageIndex。
          // 后端 `hasMore && !page.isEmpty()` 才发游标，所以续翻页的 pageParam 不会是 null。
          around: pageParam === null ? (p.around ?? null) : null
        })}`
      ),
    // 后端 records 已经是正序（Task 4），页与页之间才是倒序：拼整体时整组 pages 要反序。
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useSearchMessages(p: SearchQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.search(p, null),
    enabled: p.q.trim().length >= 2,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      http.get<MessageSearchVO>(`/api/messages/search${qs({ ...p, cursor: pageParam })}`),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useMessageStats(accountId: number | null, days: 7 | 30) {
  return useQuery({
    queryKey: queryKeys.stats(accountId, days),
    enabled: accountId !== null,
    queryFn: () => http.get<MessageStatsVO>(`/api/messages/stats${qs({ accountId, days })}`),
    refetchOnWindowFocus: false
  })
}

export function useCustomerTimeline(id: number | null, size = 20) {
  return useQuery({
    queryKey: queryKeys.timeline(id, size),
    enabled: id !== null,
    queryFn: () => http.get<CustomerTimelineVO>(`/api/customers/${id}/timeline${qs({ size })}`)
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: number) =>
      http.post<{ cleared: number }>(`/api/conversations/${conversationId}/read`),
    onSuccess: (_data, conversationId) => {
      // 本地就把角标抹掉：等 refetch 会慢一拍，用户已经在看这个会话了。
      qc.setQueriesData<{ pages: ConversationPageVO[] }>({ queryKey: queryKeys.conversationsRoot }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                records: page.records.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
              }))
            }
          : data
      )
    }
  })
}

/** 「建为客户」的第一步在 `api/customers.ts`（Step 1b）：那里已经有改删查三份 hooks，创建是第四份。 */
export function useLinkCustomer() {
  return useMutation({
    mutationFn: (input: { conversationId: number; customerId: number }) =>
      http.post<{ conversationId: number; customerId: number; messagesLinked: number }>(
        `/api/conversations/${input.conversationId}/link-customer`,
        { customerId: input.customerId }
      )
  })
}

/** 拉平成"整体时间正序"的一维数组：pages[0] 是最新页，所以整组要反着接。 */
export function flattenMessages(pages: MessagePageVO[] | undefined): MessageVO[] {
  if (!pages) return []
  return [...pages].reverse().flatMap((page) => page.records)
}

export function flattenConversations(pages: ConversationPageVO[] | undefined): ConversationVO[] {
  if (!pages) return []
  return pages.flatMap((page) => page.records)
}

export function flattenHits(pages: MessageSearchVO[] | undefined): SearchHitVO[] {
  if (!pages) return []
  return pages.flatMap((page) => page.records)
}

/**
 * 渲染层唯一的消息数组类型：库行、live 行、乐观气泡三种来源都要能进同一个 `mergeTail`，
 * 所以在这里定一次。放在本文件而不是页面组件里，因为 `liveTailSync`（写尾巴）、
 * 记录页（读两路）、客户抽屉时间线（复用气泡）三处都要这个形状，任何一处自己定义都会变成第四处。
 */
export interface ThreadRow extends TailRow {
  /** 乐观气泡还没入库，用 0 表示"无库内 id"：key 用 msgKey，不用它。 */
  id: number
  accountId: number
  chatKey: string
  direction: Direction
  status: MsgStatus
  source: MsgSource
  body: string | null
  mediaType: MediaType
  mediaSummary: string | null
  senderKey: string | null
  senderName: string | null
  customerId: number | null
  sendLocalId: string | null
}

/**
 * 后端写库与读库的墙钟固定在 `Asia/Shanghai`（`MsgTimes.CHAT_ZONE`），Jackson 出来的串是
 * 不带偏移的 `LocalDateTime`（实测 `"2026-09-22T07:48:44"`，DATETIME(3) 时带 `.123`）。
 * `dayjs(串)` 会按浏览器本地时区解析：换一台非东八区的机器，库页所有 `ts` 整体平移，
 * 而 live 帧的 `ts` 由平台 epoch 秒换算、不跟着平移——`mergeTail` 的同键判定与升序排序
 * 就是在比两组不可通的数。这里显式补回写库那个偏移，两条源才是同一个时刻。
 * 已经自带 Z 或 ±hh:mm 的串不再补，避免后端哪天换成 `OffsetDateTime` 时反向错一次。
 */
const CHAT_ZONE_OFFSET = '+08:00'

export function chatMs(msgTime: string): number {
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(msgTime)
  return dayjs(hasZone ? msgTime : `${msgTime}${CHAT_ZONE_OFFSET}`).valueOf()
}

/** 库行 → 渲染行：`ts` 走 `chatMs`，与 live 帧、乐观气泡共用 epoch 口径。 */
export function rowOfMessage(m: MessageVO): ThreadRow {
  return { ...m, ts: chatMs(m.msgTime) }
}

/** 乐观气泡：localId 派生出临时键，回执或 live 帧到达后由 `settlePending` 换成真实 msgKey。 */
export function rowOfPending(input: {
  localId: string
  accountId: number
  chatKey: string
  text: string
}): ThreadRow {
  return {
    msgKey: pendingKey(input.localId),
    ts: Date.now(),
    id: 0,
    accountId: input.accountId,
    chatKey: input.chatKey,
    direction: 'out',
    status: 'pending',
    source: 'app_send',
    body: input.text,
    mediaType: 'text',
    mediaSummary: null,
    senderKey: null,
    senderName: null,
    customerId: null,
    sendLocalId: input.localId
  }
}

/** 库页 → 渲染行：`useThreadRows` 与记录页共用这一条转换，不在页面里再 map 一次。 */
export function flattenRows(pages: MessagePageVO[] | undefined): ThreadRow[] {
  return flattenMessages(pages).map(rowOfMessage)
}
