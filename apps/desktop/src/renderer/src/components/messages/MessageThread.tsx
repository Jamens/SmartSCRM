// src/renderer/src/components/messages/MessageThread.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import MessageBubble from '@/components/messages/MessageBubble'
import { useMarkRead, useMessages, type ConversationVO } from '@/api/messages'
import { useThreadRows } from '@/lib/liveTailSync'
import { dayLabel, groupByDay } from '@/lib/chatDays'
import { titleOfConversation } from '@/lib/chatDisplay'

const PAGE_SIZE = 30
/** 距底 80px 以内算"在看着底部"——差一个像素就把跟底关掉的话，滚动惯性会让人错过新消息。 */
const NEAR_BOTTOM_PX = 80

interface Props {
  accountId: number
  conversation: ConversationVO
  /** Task 15 的回复框从这里进来；本任务不传，线程照常展示历史。 */
  footer?: ReactNode
}

export default function MessageThread({
  accountId,
  conversation,
  footer
}: Props): React.JSX.Element {
  const markRead = useMarkRead().mutate
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useMessages({
    accountId,
    chatKey: conversation.chatKey,
    size: PAGE_SIZE
  })
  const rows = useThreadRows(accountId, conversation.chatKey, data?.pages)
  const sections = useMemo(() => groupByDay(rows), [rows])

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 翻页前记下的视口尺寸：新页插进来之后要用它把高度差补回去。 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const atBottomRef = useRef(true)

  /**
   * 清未读的记号：`会话 id + 会话头时间`。同一笔未读只清一次，StrictMode 在 dev 把挂载 effect 跑两遍
   * 时不会变成两次 POST /read（实测第一次进会话 2 次、切到别的会话再回来 1 次，差别只在"挂载"还是"换 props"）。
   * 列表 refetch 把新消息计成未读时，未读只由插入推动、`lastMsgTime` 一定跟着走 → 记号是新的 → 这里仍会再清一次。
   * 失败要把记号删掉：不然下一次渲染被 `has()` 挡住，角标就一直挂着。
   */
  const readMark = `${conversation.id}|${conversation.lastMsgTime ?? ''}`
  const clearedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    // 进会话就清未读（收敛 11 的"尽力值"）：只看 `unreadCount > 0`，不比较游标。
    if (conversation.unreadCount <= 0 || clearedRef.current.has(readMark)) return
    clearedRef.current.add(readMark)
    markRead(conversation.id, { onError: () => clearedRef.current.delete(readMark) })
  }, [conversation, readMark, markRead])
  const onScroll = (): void => {
    const el = scrollerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    if (el.scrollTop <= 4 && hasNextPage && !isFetchingNextPage) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      void fetchNextPage()
    }
  }

  // 1) 上滑补页：把新页插入造成的高度差抵消掉。不补的话视觉上是"跳到顶部又停住"，
  //    用户刚刚看到的那条消息会飞出视口。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    anchorRef.current = null
    el.scrollTop = el.scrollHeight - anchor.height + anchor.top
    atBottomRef.current = false
  }, [data?.pages])

  // 2) 跟底：声明顺序保证它跑在补位之后——补页时 atBottomRef 已被翻成 false，
  //    所以拉历史不会被强行拽回底部；live 帧到达时它才是"在底部的人"才跟。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [rows.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {titleOfConversation(conversation)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.chatKey}
            {conversation.customerId === null && !conversation.isGroup && (
              <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                陌生
              </Badge>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{rows.length} 条</span>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        data-p6-scroller="thread"
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        {isPending && <p className="py-6 text-center text-xs text-muted-foreground">加载消息中…</p>}
        {isError && (
          <p className="py-6 text-center text-xs text-destructive">
            无法读取历史消息，请确认后端已启动。
          </p>
        )}
        {!isPending && !isError && rows.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            这个会话还没有采集到消息。
          </p>
        )}
        {isFetchingNextPage && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">正在拉更早的消息…</p>
        )}
        {!hasNextPage && rows.length > 0 && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">已经到最早的一条</p>
        )}
        {sections.map((section) => (
          <section key={section.day}>
            <div className="my-3 flex justify-center">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                {dayLabel(section.day)}
              </span>
            </div>
            {section.rows.map((row) => (
              <MessageBubble key={row.msgKey} row={row} showSender={conversation.isGroup} />
            ))}
          </section>
        ))}
      </div>

      {footer}
    </div>
  )
}
