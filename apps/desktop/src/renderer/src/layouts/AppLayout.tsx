import { Outlet } from 'react-router-dom'
import TitleBar from '@/components/TitleBar'
import ModuleRail from '@/components/ModuleRail'
import { useTranslationSync } from '@/lib/translationSync'
import { useLoginStatusSync } from '@/lib/loginStatusSync'
import { useLiveTailSync } from '@/lib/liveTailSync'
import { useUnreadBadge } from '@/lib/unreadBadge'

interface Props {
  onLogout: () => void
}

export default function AppLayout({ onLogout }: Props): React.JSX.Element {
  useTranslationSync()
  useLoginStatusSync()
  // 挂在布局层而不是记录页里：`msg:live` 是广播，切走路由时如果取消订阅，回到记录页之前
  // 那段时间的尾巴就永久丢了（历史页能翻到，但未读与会话头要靠它）。
  useLiveTailSync()
  // 同样挂在布局层：切走记录页时角标还得继续报（最小化的窗口最需要在别的软件上看得见未读）。
  // 放在这里也意味着未登录时不跑——`/api/messages/unread-total` 要 token，登录页上轮询只会 401。
  useUnreadBadge()
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
