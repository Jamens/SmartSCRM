// src/renderer/src/pages/MessagesPage.tsx
import { useState } from 'react'
import { History, MessagesSquare, Search } from 'lucide-react'
import ConversationList from '@/components/messages/ConversationList'
import MessageThread from '@/components/messages/MessageThread'
import ReplyComposer from '@/components/messages/ReplyComposer'
import SearchPanel from '@/components/messages/SearchPanel'
import StatsCards from '@/components/messages/StatsCards'
import { useMarkRead } from '@/api/messages'
import {
  flattenConversations,
  unfilteredConversationQuery,
  useConversations,
  type ConversationVO
} from '@/api/messages'
import { useSelectionStore } from '@/stores/accounts'
import { type JumpTarget } from '@/lib/chatSearch'
import { cn } from '@/lib/utils'

type View = 'conversations' | 'search'

function ViewTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-p6-view={label}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export default function MessagesPage(): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const markRead = useMarkRead().mutate
  const [view, setView] = useState<View>('conversations')
  /** 点选那一刻的行：id 归属判定与"列表里找不到时"的兜底都靠它。 */
  const [picked, setPicked] = useState<ConversationVO | null>(null)
  /** 搜索跳转带进来的锚点；与 `picked` 同源同生命周期（换会话即清），见 `onPick` 与 `MessageThread`。 */
  const [anchor, setAnchor] = useState<JumpTarget['anchor'] | null>(null)
  /**
   * 再拿一份**无筛选条件**的首屏：左列正在筛关键字时那份缓存里没有当前会话，所以页面不能跟着它的键走；
   * 而无筛选时两边用的是同一个 `unfilteredConversationQuery`（同一个对象形状）→ 同一份缓存、一次请求。
   */
  const { data: headPages } = useConversations(unfilteredConversationQuery(selectedId))

  /**
   * 账号就是工作台选中的那个：发送要靠该账号的内嵌视图与桥，记录页另选一个"发送时才知道
   * 没登录"的账号没有意义。所以这里不建本地账号 state，读写都走同一个 store。
   *
   * chat_key 只在一个账号内唯一：选中的会话不属于当前账号就不能用，否则右列读的是上一个账号的尾巴。
   * 按"归属"派生而不是在 effect 里 setPicked(null)：一是 `react-hooks` 把 effect 内同步 setState
   * 判成错误（级联渲染），二是判"selectedId 变了"会误伤搜索跳转——它一次同时改账号与
   * 选中会话（跨账号命中），无条件清会把刚跳进来的会话立刻抹掉，用户只看到右列闪一下就空了。
   */
  const owned = picked !== null && picked.accountId === selectedId ? picked : null
  /**
   * 右列用**列表里那一条的现值**而不是点选时的快照：会话头与未读会随新消息走，快照停在点进来的
   * 那一瞬——`MessageThread` 里"未读涨了就把这一笔再清一次"那条路于是走不到，正在看的会话角标会
   * 一直挂着，标题与客户徽标（Task 17 挂上客户）也不会更新。列表里查不到时（被关键字筛掉、掉到
   * 首屏那一页之外）退回快照，右列照常能读，只是不再跟着 refetch 动。搜索跳转拼出的那条是合成行，
   * 落在同一个兜底分支上：列表里查不到就用它，`MessageThread` 读的是 `chatKey`，两者等价。
   */
  const conversation =
    owned === null
      ? null
      : (flattenConversations(headPages?.pages).find((c) => c.id === owned.id) ?? owned)

  /** 搜索结果 → 换账号、选会话、记锚点、切回会话视图。四件事必须一起发生，所以在同一个函数里做完。 */
  const jump = (target: JumpTarget): void => {
    select(target.conversation.accountId)
    setPicked(target.conversation)
    setAnchor(target.anchor)
    setView('conversations')
    // 合成行的 unreadCount 是 0，不主动清就永远挂着角标：跳进来就等于"我已经看到这条了"。
    markRead(target.conversation.id)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <ConversationList
        accountId={selectedId}
        onAccountIdChange={select}
        picked={conversation}
        onPick={(c) => {
          // 从列表选会话 = 看最新，锚点要一起清掉。MessageThread 里还有一道 chatKey 校验：
          // 两处各管一半——这里管"用户意图"，那里管"别拿旧 around 去打新会话"（后端会回 40404，右列整个空掉）。
          setAnchor(null)
          setPicked(c)
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <History className="size-5 text-primary" />
            聊天记录
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <ViewTab
              active={view === 'conversations'}
              icon={<MessagesSquare className="size-3.5" />}
              label="会话"
              onClick={() => setView('conversations')}
            />
            <ViewTab
              active={view === 'search'}
              icon={<Search className="size-3.5" />}
              label="全局搜索"
              onClick={() => setView('search')}
            />
          </div>
        </header>

        {/* 统计卡只在会话视图出现：搜索视图要的是尽可能多的结果行，两者抢同一条竖向空间。 */}
        {view === 'conversations' && <StatsCards accountId={selectedId} />}

        {view === 'search' ? (
          <SearchPanel onJump={jump} currentCustomerId={conversation?.customerId ?? null} />
        ) : conversation && selectedId !== null ? (
          /**
           * `key` 带账号与会话：切会话时整条线程重挂载。线程的滚动 state 全是组件内的 ref
           * （`atBottomRef` / 翻页前记的 `anchorRef`），不重挂载就会带着上一条的残留进新会话——
           * 上一条停在中间时新会话也落在中间（而不是最新一条），而在翻页途中切换会话时，那份
           * `anchorRef` 记的是**旧会话**的高度，补位算出来的是个任意位置。
           *
           * 回复框在这条边界之内，所以换会话时它那份未发出的草稿也一起作废——这是要的：
           * 给甲写了一半的话不该在点开乙之后还在框里，更不该被 Enter 发进乙的会话。
           */
          <MessageThread
            key={`${selectedId}:${conversation.chatKey}`}
            accountId={selectedId}
            conversation={conversation}
            anchor={anchor}
            onClearAnchor={() => setAnchor(null)}
            footer={<ReplyComposer accountId={selectedId} conversation={conversation} />}
          />
        ) : (
          <p className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {selectedId === null
              ? '先在工作台添加并选择一个平台账号。'
              : '从左侧选择一个会话查看记录。'}
          </p>
        )}
      </main>
    </div>
  )
}
