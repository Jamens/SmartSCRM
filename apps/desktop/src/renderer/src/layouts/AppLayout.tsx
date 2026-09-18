import { Outlet } from 'react-router-dom'
import TitleBar from '@/components/TitleBar'
import ModuleRail from '@/components/ModuleRail'

interface Props {
  onLogout: () => void
}

export default function AppLayout({ onLogout }: Props): React.JSX.Element {
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
