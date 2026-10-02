import { Outlet, useNavigate } from 'react-router-dom'
import TitleBar from '@/components/TitleBar'
import ModuleRail from '@/components/ModuleRail'
import { useTranslationSync } from '@/lib/translationSync'
import { useLoginStatusSync } from '@/lib/loginStatusSync'
import { useLiveTailSync } from '@/lib/liveTailSync'
import { useUnreadBadge } from '@/lib/unreadBadge'
import { useGroupStateInvalidation } from '@/api/groupMembers'
import { useNotifyJump } from '@/lib/desktopNotify'
import { useSelectionStore } from '@/stores/accounts'
import { useChatJumpStore } from '@/stores/chatJump'

interface Props {
  onLogout: () => void
}

export default function AppLayout({ onLogout }: Props): React.JSX.Element {
  const navigate = useNavigate()
  const select = useSelectionStore((s) => s.select)
  const holdKey = useChatJumpStore((s) => s.holdKey)

  useTranslationSync()
  useLoginStatusSync()
  // 挂在布局层而不是记录页里：`msg:live` 是广播，切走路由时如果取消订阅，回到记录页之前
  // 那段时间的尾巴就永久丢了（历史页能翻到，但未读与会话头要靠它）。
  useLiveTailSync()
  // 同样挂在布局层：切走记录页时角标还得继续报（最小化的窗口最需要在别的软件上看得见未读）。
  // 放在这里也意味着未登录时不跑——`/api/messages/unread-total` 要 token，登录页上轮询只会 401。
  useUnreadBadge()
  // 群与成员的缓存失效也挂布局层：`group:state` 是广播，切走客户页时那一轮建档照样会结。
  // 挂在这里还有一层意义——没登录时不跑，`window.scrm.group.onState` 不需要 token，但读数要。
  useGroupStateInvalidation()

  /**
   * 桌面通知（A17）被点击：切到那个账号 → 记下 chatKey → 去消息页。
   *
   * 定位是**尽力而为**：主进程广播里只有 `{ accountId, chatKey }`，拿不到整条会话，
   * 所以消息页在已加载的会话里按 chatKey 找；找不到（不在当前筛选、掉在首屏之外）
   * 是正常的，那时停在消息页，不报错、不伪造一条会话、不清空已经选中的会话。
   */
  useNotifyJump(({ accountId, chatKey }) => {
    select(accountId)
    holdKey(chatKey)
    navigate('/messages')
  })
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TitleBar onLogout={onLogout} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ModuleRail />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
