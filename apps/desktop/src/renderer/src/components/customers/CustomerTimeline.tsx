// src/renderer/src/components/customers/CustomerTimeline.tsx
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, MessageSquareDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MessageBubble from '@/components/messages/MessageBubble'
import { rowOfMessage, useCustomerTimeline, type ConversationVO } from '@/api/messages'
import { groupByConversation } from '@/lib/chatTimeline'
import { titleOfConversation } from '@/lib/chatDisplay'
import { listTime } from '@/lib/chatDays'
import { useChatJumpStore } from '@/stores/chatJump'

/** 产品口径就是"最近消息"：端点只有 `size`，没有游标，这里也不做翻页。 */
const SIZE = 20

export default function CustomerTimeline({ customerId }: { customerId: number }): React.JSX.Element {
  const { data, isPending, isError } = useCustomerTimeline(customerId, SIZE)
  const navigate = useNavigate()
  const hold = useChatJumpStore((s) => s.hold)

  // ThreadRow 是气泡唯一吃的行形状（Task 13），时间线复用气泡就不许再造第二种行。
  const groups = useMemo(
    () => (data ? groupByConversation(data.messages.map(rowOfMessage), data.conversations) : []),
    [data]
  )
  /** 跳转要整份 `ConversationVO`；回落组（没有会话头）拿不到 `accountId`，只能不给按钮。 */
  const headOf = useMemo(() => {
    const map = new Map<string, ConversationVO>()
    for (const c of data?.conversations ?? []) map.set(c.chatKey, c)
    return map
  }, [data])

  if (isPending) return <p className="text-xs text-muted-foreground">读取最近消息…</p>
  if (isError) return <p className="text-xs text-destructive">读不到时间线，请确认后端已启动。</p>
  if (groups.length === 0) {
    return (
      <p data-p6-timeline="empty" className="text-xs text-muted-foreground">
        还没有采到这位客户的消息。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-p6-timeline="list">
      {groups.map((group) => {
        const head = headOf.get(group.chatKey)
        return (
          <section
            key={group.chatKey}
            data-p6-timeline-group={group.chatKey}
            className="rounded-xl border border-border/60 px-3 pt-2 pb-1"
          >
            <header className="mb-1 flex items-center gap-2">
              <MessageSquareDashed className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {head ? titleOfConversation(head) : group.title}
                {group.isGroup && <span className="ml-1 text-[10px] text-muted-foreground">群</span>}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{listTime(group.lastTs)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                data-p6-timeline-jump={group.chatKey}
                disabled={!head}
                title={head ? '在聊天记录页打开这个会话' : '这条会话的会话头还没投影出来，暂时跳不过去'}
                onClick={() => {
                  if (!head) return
                  hold(head)
                  navigate('/messages')
                }}
              >
                <ArrowUpRight className="size-3" />
                打开
              </Button>
            </header>
            {group.rows.map((row) => (
              <MessageBubble key={row.msgKey} row={row} showSender={group.isGroup} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
