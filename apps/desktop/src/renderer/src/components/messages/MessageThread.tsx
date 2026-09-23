// src/renderer/src/components/messages/MessageThread.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import MessageBubble from '@/components/messages/MessageBubble'
import { useMarkRead, useMessages, type ConversationVO } from '@/api/messages'
import { useTranslationSettings } from '@/api/translation'
import { gateDraft, TOO_LONG_HINT } from '@/lib/sendDraft'
import { useSendText, useThreadRows } from '@/lib/liveTailSync'
import { dayLabel, groupByDay } from '@/lib/chatDays'
import { titleOfConversation } from '@/lib/chatDisplay'
import { HIGHLIGHT_MS, type JumpTarget } from '@/lib/chatSearch'

const PAGE_SIZE = 30
/** 距底 80px 以内算"在看着底部"——差一个像素就把跟底关掉的话，滚动惯性会让人错过新消息。 */
const NEAR_BOTTOM_PX = 80

interface Props {
  accountId: number
  conversation: ConversationVO
  /** Task 15 的回复框从这里进来；本任务不传，线程照常展示历史。 */
  footer?: ReactNode
  /** 搜索跳转带进来的锚点；`chatKey` 不匹配时一律忽略（陈旧锚点会让后端回 40404，整列空掉）。 */
  anchor?: JumpTarget['anchor'] | null
  onClearAnchor?: () => void
  /** 会话头右侧的动作区（Task 17 的「语向」与「建为客户」）。线程组件不认识那两个弹层。 */
  headerExtra?: ReactNode
}

export default function MessageThread({
  accountId,
  conversation,
  footer,
  anchor,
  onClearAnchor,
  headerExtra
}: Props): React.JSX.Element {
  const markRead = useMarkRead().mutate
  const around = anchor && anchor.chatKey === conversation.chatKey ? anchor.messageId : null
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useMessages({
    accountId,
    chatKey: conversation.chatKey,
    size: PAGE_SIZE,
    around
  })
  const rows = useThreadRows(accountId, conversation.chatKey, data?.pages)
  const sections = useMemo(() => groupByDay(rows), [rows])
  /**
   * 失败气泡的「重试」走同一条发送链（新 localId = 新气泡），不另开一条路。
   * 设置读的是回复框那一层（同一个 `customerId`、同一份缓存条目，TanStack 会去重），因为
   * **重试也必须过闸**：`MessageBubble` 的失败插槽对任何 `out` + `failed` 的行都会出现，
   * 里面包含 `source:'native_send'`（在页面里发的、本应用从没判过正文的那一类），
   * 那些正文从没走过 `decideDraft`。不闸一次，就是"中文拦截开着时点一下重试，中文原样出去"。
   */
  const { data: settings } = useTranslationSettings(conversation.customerId)
  const { send } = useSendText(accountId, conversation.chatKey)
  /**
   * 重入闸：**每个失败行一个在飞名额**，第二次激活是空操作。
   *
   * 不变式：同一行在结清之前，最多只有一笔发送在路上。要挡的是 `ReplyComposer` 那个 `busy`
   * 闸挡掉的同一件事，而且这里更宽——重试按钮点中之后就保有焦点，长按 Enter 的键重复与双击
   * 都会把 `onClick` 打进来好几次，而每一次激活都会 `crypto.randomUUID()` mint 一个新 localId
   * → 同一条正文发出去 N 遍，客户那边看得一清二楚。
   *
   * 用 `ref` 而不是 state：占位与检查必须在**第一个 await 之前同步**完成，同一批事件里
   * 后一次激活才能看见前一次的占位（state 要等重渲染才更新，读到的还是旧值）。
   * 按 `msgKey` 分名额而不是整页一个闸：重试一条不该把另一条失败气泡也锁住。
   */
  const inFlight = useRef<Set<string>>(new Set())
  /** 闸门给出的拒绝理由挂在哪条气泡上（线程里没有全局提示位，理由要说清是哪一条）。 */
  const [gateHint, setGateHint] = useState<{ rowKey: string; text: string } | null>(null)

  // 不用 useCallback 包：这里的正确性不依赖函数身份（在飞的名额在 `inFlight` 那个 ref 里，
  // 不在闭包里），而 `useSendText` 每次渲染都返回新对象，包了也稳不住引用。
  const retryFrom = async (rowKey: string, body: string): Promise<void> => {
    if (inFlight.current.has(rowKey)) return
    inFlight.current.add(rowKey)
    // 只抹这一次点的那条气泡的理由：整体置 null 会把另一条气泡上挂着的理由一起清掉。
    setGateHint((current) => (current && current.rowKey === rowKey ? null : current))
    try {
      if (!settings) {
        // 没有闸门依据就**不发**：放出去的是一条没判过中文的正文，而那正是这道闸存在的理由。
        // 拿不到设置通常是后端没在线，那种情况下回复框也判成离线，这里跟着一起停住才是同一套语义。
        setGateHint({ rowKey, text: '还没读到翻译设置，稍后再试' })
        return
      }
      const gate = gateDraft(body, settings)
      if (gate.kind !== 'ok') {
        setGateHint({ rowKey, text: gate.kind === 'tooLong' ? TOO_LONG_HINT : gate.reason })
        return
      }
      // 发出去的是 trim 过的那一份：闸门量的就是它，回复框发的也是它，三处同口径才不会
      // 出现"这里放行、主进程 `isSendable`（量原始长度）却拒掉"的差一。全空白的正文
      //（库里确实有只敲了空格的 `native_send` 行）按"没有内容"停下，比让主进程回一条
      // 说不清原因的 SEND_FAILED 诚实。
      const text = body.trim()
      if (!text) {
        setGateHint({ rowKey, text: '这条消息是空白的，没有可重发的内容' })
        return
      }
      // 不重译：重发的是这条失败消息的正文，再译一遍会让"重发出去的内容"和
      // "当初失败的内容"不一致。闸门只管拦截 + 长度这半边。
      await send(text)
    } finally {
      // 名额在"结清 / 被闸停下 / 异常"三条路上都回到这里之后才交还。写在 finally 里而不是
      // 成功分支末尾：`send` 按契约不抛（`liveTailSync.useSendText` 的文档注释钉着这件事），
      // 但一次意外拒绝就把这一行的重试永久锁死，代价比"多一道无条件释放"大得多。
      inFlight.current.delete(rowKey)
    }
  }

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

  // 3) 锚定：声明顺序同样是硬要求——必须排在补位与跟底之后，同一个 useLayoutEffect 批次里
  //    后写的 scrollTop 覆盖先写的，排在跟底之前就会被"滚到底"抹掉。
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  /** 每个锚点只滚一次：live 帧会让 rows 变化，不记一笔就会每来一条拽回去一次。 */
  const anchoredRef = useRef<string | null>(null)
  /**
   * 只记"上一次看到的 chatKey"，不记"是不是挂载后第一轮"——后者在这套 dev 环境里会被
   * `<StrictMode>` 打穿：模拟卸载会再跑一遍 setup，用"第一轮跳过"当闸门的话，第二遍就被当成
   * 换了会话，把 layout effect 刚设上的高亮抹掉。同一个套路本文件的 `clearedMarkRef`（清未读那一处）
   * 已经用过一次，理由是同一个：挂载 effect 跑两遍。
   *
   * 而挂载第一轮确实不能"顺手清一次"。`useMessages` 没有设 staleTime，重复跳同一条命中时缓存里的行
   * 在挂载那一次 commit 就渲染出来了：锚定 layout effect 先跑（滚到位 + 设高亮），这条 passive
   * effect 后跑。实测（`tmp/p6h-g17.mjs`）：冷缓存那一路 ring=true，热缓存那一路 ring=false，
   * 两次的 scrollTop 都是 318 —— 位置跳对了、亮没亮出来，就是这一句 `setHighlightKey(null)` 干的。
   * 挂载时 `anchoredRef` 本来就是 null、高亮本来就是空，清与不清的差别只剩"把刚点亮的抹掉"。
   *
   * 改完两路都亮（`tmp/p6h-g19.mjs`，每 10ms 采一次 DOM 的 `ring-1`）：冷挂载 1986ms、
   * 热缓存 1997ms，都在 2 秒退场。
   */
  const seenChatKeyRef = useRef<string | null>(conversation.chatKey)

  useEffect(() => {
    if (seenChatKeyRef.current === conversation.chatKey) return
    seenChatKeyRef.current = conversation.chatKey
    // 换会话就忘掉上一个锚点：anchor 由页面清，但 chatKey 一变，本组件里绝不能再滚。
    // 分工写清楚，别让读的人以为闸只有这一道：第一道是页面 `onPick` 清 anchor + `around` 与本 effect
    // 两侧的 `chatKey` 校验，第二道才是当前消费者带 `key={selectedId:chatKey}` 重挂载（真换了会话时
    // 这条 effect 其实跑不到——组件已经换成新的了）。它守的是"同一实例内 chatKey 变了却没重挂载"那种将来。
    anchoredRef.current = null
    setHighlightKey(null)
  }, [conversation.chatKey])

  /**
   * 2 秒退场单独立一条 effect，依赖只有 `highlightKey`。放在锚定那条 layout effect 里管不住：
   * 那条的依赖是 `[anchor, rows]`，live 帧一改 rows 就 cleanup + 重跑，重跑又因为 `anchoredRef`
   * 已命中直接 return —— 计时器被掐了却没人重新点上，"2 秒"变成"直到下一次切会话"；改成 ref 存
   * 计时器、只在卸载收口，又会被 `<StrictMode>` 的模拟卸载掐掉同一刀。依赖收成 `highlightKey`
   * 之后两条路都到不了：亮着就一定有一个计时器在跑，灭了 cleanup 自己把它收掉。
   */
  useEffect(() => {
    if (highlightKey === null) return
    const timer = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlightKey])

  useLayoutEffect(() => {
    /**
     * `chatKey` 这道校验和上面 `around` 那道是同一件事的两半，必须都做：`data-msg-key` 的值是平台原生
     * id，只在同一条会话内唯一（`MessageBubble` 的注释钉着这条），所以一个属于别的会话的旧锚点**能**在
     * 当前这一屏里命中同号节点——只按 `msgKey` 定位就会滚过去并给它描边，而定位条不出现（`around` 为
     * null 时它是藏的），表现就是"亮了但不是跳的那条"。今天的消费者带 `key={selectedId:chatKey}` 重挂载、
     * 页面 `onPick` 也会清锚点，所以打不到；但 Task 18「跳回记录页」会新增写 `anchor` 的入口，那时注释里
     * 的分工就只靠这一行撑着。
     */
    const key = anchor && anchor.chatKey === conversation.chatKey ? anchor.msgKey : null
    if (!key || anchoredRef.current === key) return
    const row = scrollerRef.current?.querySelector<HTMLElement>(`[data-msg-key="${CSS.escape(key)}"]`)
    // 还没渲染出来：上滑翻页途中锚点行会自己出现，下一轮 rows 变化再来滚
    if (!row) return
    anchoredRef.current = key
    row.scrollIntoView({ block: 'end' })
    setHighlightKey(key)
    // rows 而不是 rows.length：锚点行可能在长度不变时由尾巴合并换进来
  }, [anchor, rows])

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
        <div className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <span className="text-xs text-muted-foreground">{rows.length} 条</span>
        </div>
      </div>

      {/*
        定位条只在**锚点真的作用到了窗口**时出现：`around === null` 有两种情况（没有锚点、
        锚点属于另一条会话），那两种都是默认窗口，说着"比它更新的消息不在这个窗口里"就是假话。
      */}
      {anchor && around !== null && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-primary/5 px-6 py-1.5">
          <span className="truncate text-[11px] text-muted-foreground">
            已定位到 {anchor.label} 那条消息：更早的记录在下面，比它更新的消息不在这个窗口里。
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => onClearAnchor?.()}
          >
            回到最新
          </Button>
        </div>
      )}

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
            {section.rows.map((row) => {
              // 正文在这里收窄一次就够：插槽的三元与点击回调读的是同一份 `body`。
              // 回调里再写 `if (row.body)` 不是多一道保险——闭包会丢掉 TS 对 `row.body`
              // 这条属性路径的收窄，所以要么传这个已判过的 const，要么就得重测一遍。
              const body = row.body
              return (
                <MessageBubble
                  key={row.msgKey}
                  row={row}
                  showSender={conversation.isGroup}
                  highlight={highlightKey === row.msgKey}
                  failedHint={
                    body ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[11px]"
                          onClick={() => {
                            // 新 localId = 第二条气泡，旧的留在原地，看得出重试过（spec §5 的幂等口径）。
                            // 不额外提示成败：气泡自己的状态就是提示（pending 转圈 / 失败仍是 ⚠），
                            // 再加一条 toast 只会把"两条气泡哪条是新的"变得更难看清。
                            // 状态推进靠 ack 帧（`msg:status` → `applyLiveStatus`），它只推尾巴里已有的
                            // 那一行；行只在库页里时，打开着的线程不会自己去重取，所以这里"不额外提示"
                            // 仍然有代价。
                            void retryFrom(row.msgKey, body)
                          }}
                        >
                          重试
                        </Button>
                        {gateHint?.rowKey === row.msgKey && (
                          // 被闸门停下的一击：不另外发一条 toast，理由就写在点它的那条气泡后面。
                          <span className="text-[11px] text-destructive">{gateHint.text}</span>
                        )}
                      </>
                    ) : undefined
                  }
                />
              )
            })}
          </section>
        ))}
      </div>

      {footer}
    </div>
  )
}
