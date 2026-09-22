// src/renderer/src/pages/MessagesPage.tsx
import { useState } from 'react'
import { History } from 'lucide-react'
import ConversationList from '@/components/messages/ConversationList'
import MessageThread from '@/components/messages/MessageThread'
import { useSelectionStore } from '@/stores/accounts'
import type { ConversationVO } from '@/api/messages'

export default function MessagesPage(): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const [picked, setPicked] = useState<ConversationVO | null>(null)

  /**
   * 账号就是工作台选中的那个：发送要靠该账号的内嵌视图与桥，记录页另选一个"发送时才知道
   * 没登录"的账号没有意义。所以这里不建本地账号 state，读写都走同一个 store。
   */
  /**
   * chat_key 只在一个账号内唯一：选中的会话不属于当前账号就不能用，否则右列读的是上一个账号的尾巴。
   * 按"归属"派生而不是在 effect 里 setPicked(null)：一是 `react-hooks` 把 effect 内同步 setState
   * 判成错误（级联渲染），二是判"selectedId 变了"会误伤 Task 16 的搜索跳转——它一次同时改账号与
   * 选中会话（跨账号命中），无条件清会把刚跳进来的会话立刻抹掉，用户只看到右列闪一下就空了。
   */
  const conversation = picked !== null && picked.accountId === selectedId ? picked : null

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <ConversationList
        accountId={selectedId}
        onAccountIdChange={select}
        picked={conversation}
        onPick={setPicked}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <History className="size-5 text-primary" />
            聊天记录
          </h1>
        </header>
        {conversation && selectedId !== null ? (
          <MessageThread accountId={selectedId} conversation={conversation} />
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
