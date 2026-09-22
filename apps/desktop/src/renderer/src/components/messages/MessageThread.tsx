// src/renderer/src/components/messages/MessageThread.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import MessageBubble from '@/components/messages/MessageBubble'
import { useMarkRead, useMessages, type ConversationVO } from '@/api/messages'
import { useSendText, useThreadRows } from '@/lib/liveTailSync'
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
  /** 失败气泡的「重试」走同一条发送链（新 localId = 新气泡），不另开一条路。 */
  const { send } = useSendText(accountId, conversation.chatKey)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 翻页前记下的视口尺寸：新页插进来之后要用它把高度差补回去。 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const atBottomRef = useRef(true)

  /**
   * 清未读：`unreadCount > 0` 就发 `POST /read`，但**同一笔未读只发一次**。挡重复用三层记号
   * `会话 id + 会话头时间 + 未读数`，并在看到 `unreadCount` 归零时把记号抹掉重新武装：
   *
   * - 为什么带上未读数：`upsertHead` 的 `last_msg_time` 是 `IF(VALUES(...) > 现值)` 才前进的
   *   （`ChatConversationMapper`），而 `unread_count = unread_count + delta` 无条件——一条比会话头更老的
   *   live 行（时钟偏慢、迟到投递，spec §9 自己列的那条）会只涨未读、不动头。只用 `id + 头时间`
   *   做记号时这种未读永远撞不开，角标就挂在正在看的这条会话上。
   * - 为什么归零要抹记号：`useMarkRead.onSuccess` 本地就把角标清零了，所以"清完再来一笔"必然经过 0；
   *   记号留在内存里会让下一次 `unreadCount` 回到同一个数时被当成同一笔。
   * - 为什么只留最近一笔、不攒集合：本组件按"账号 + 会话"重挂载（MessagesPage 的 `key`），换一条会话
   *   记号自然作废；留着同一笔也只在"清完又涨回同一个未读数"时挡路，而那正是上面归零重新武装要放行的一次。
   * - 失败必须抹记号：`onError` 那条分支不抹的话，下一次渲染被同一个记号挡住，角标也永远挂着。
   *
   * 少了这层记号会怎样是实测过的：dev 的 `<StrictMode>` 把挂载 effect 跑两遍，第一次进会话就是
   * 2 次 POST（同一毫秒、都 code:0）；列表 refetch 还会带着新引用再触发。
   */
  const readMark = `${conversation.id}|${conversation.lastMsgTime ?? ''}|${conversation.unreadCount}`
  const clearedMarkRef = useRef<string | null>(null)
  useEffect(() => {
    if (conversation.unreadCount <= 0) {
      clearedMarkRef.current = null
      return
    }
    if (clearedMarkRef.current === readMark) return
    clearedMarkRef.current = readMark
    markRead(conversation.id, {
      onError: () => {
        if (clearedMarkRef.current === readMark) clearedMarkRef.current = null
      }
    })
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
              <MessageBubble
                key={row.msgKey}
                row={row}
                showSender={conversation.isGroup}
                failedHint={
                  row.body ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[11px]"
                      onClick={() => {
                        // 重发的是这条失败消息的正文，不再翻一遍：再译会让"重发出去的内容"
                        // 和"当初失败的内容"不一致。新 localId = 第二条气泡，旧的留在原地，
                        // 看得出重试过（spec §5 的幂等口径）。
                        // 不额外提示成败：气泡自己的状态就是提示（pending 转圈 / 失败仍是 ⚠），
                        // 再加一条 toast 只会把"两条气泡哪条是新的"变得更难看清。
                        if (row.body) void send(row.body)
                      }}
                    >
                      重试
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </section>
        ))}
      </div>

      {footer}
    </div>
  )
}
