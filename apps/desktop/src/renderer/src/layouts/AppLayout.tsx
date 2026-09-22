import { Outlet } from 'react-router-dom'
import TitleBar from '@/components/TitleBar'
import ModuleRail from '@/components/ModuleRail'
import { useTranslationSync } from '@/lib/translationSync'
import { useLoginStatusSync } from '@/lib/loginStatusSync'
import { useLiveTailSync } from '@/lib/liveTailSync'

interface Props {
  onLogout: () => void
}

export default function AppLayout({ onLogout }: Props): React.JSX.Element {
  useTranslationSync()
  useLoginStatusSync()
  // 挂在布局层而不是记录页里：`msg:live` 是广播，切走路由时如果取消订阅，回到记录页之前
  // 那段时间的尾巴就永久丢了（历史页能翻到，但未读与会话头要靠它）。
  useLiveTailSync()
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
