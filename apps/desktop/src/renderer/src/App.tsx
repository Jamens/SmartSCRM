import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import AppLayout from '@/layouts/AppLayout'
import HomePage from '@/pages/HomePage'
import MessagesPage from '@/pages/MessagesPage'
import CustomersPage from '@/pages/CustomersPage'
import LabelsPage from '@/pages/LabelsPage'
import AudiencesPage from '@/pages/AudiencesPage'
import { BroadcastPage } from '@/pages/BroadcastPage'
import QuickRepliesPage from '@/pages/QuickRepliesPage'
import MaterialsPage from '@/pages/MaterialsPage'
import TranslationPage from '@/pages/TranslationPage'
import SettingsPage from '@/pages/SettingsPage'
import LogCenterPage from '@/pages/LogCenterPage'
import NotificationsPage from '@/pages/NotificationsPage'
import HelpPage from '@/pages/HelpPage'
import AiWorkspacePage from '@/pages/AiWorkspacePage'
import DashboardPage from '@/pages/DashboardPage'
import ScriptPage from '@/pages/ScriptPage'
import GroupOpsPage from '@/pages/GroupOpsPage'
import NurturePlanPage from '@/pages/NurturePlanPage'
import AutomationPage from '@/pages/AutomationPage'
import CloudPhonePage from '@/pages/CloudPhonePage'
import LoginPage from '@/pages/LoginPage'
import { DEFAULT_NAV_PATH } from '@/lib/nav'
import { useProtocolSync } from '@/hooks/useProtocolSync'
import { LoaderCircle } from 'lucide-react'

function App(): React.JSX.Element {
  const phase = useAuthStore((s) => s.phase)
  const boot = useAuthStore((s) => s.boot)
  const logout = useAuthStore((s) => s.logout)

  // 协议号（type-7）独立通道同步：登录态下为所有协议号账号建立网关 WS 推送。
  useProtocolSync()

  useEffect(() => {
    void boot()
  }, [boot])

  if (phase === 'boot') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#081A45] via-primary to-[#132f75]">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-gold/50">
          <LoaderCircle className="size-7 animate-spin text-gold" />
        </div>
        <p className="text-sm tracking-[0.3em] text-blue-50/80 uppercase">SmartSCRM</p>
      </div>
    )
  }

  if (phase === 'anonymous') {
    return <LoginPage />
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout onLogout={() => void logout()} />}>
          <Route index element={<Navigate to={DEFAULT_NAV_PATH} replace />} />
          <Route path="/workspace" element={<HomePage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/labels" element={<LabelsPage />} />
          <Route path="/audiences" element={<AudiencesPage />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/quick-replies" element={<QuickRepliesPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/translation" element={<TranslationPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/ai" element={<AiWorkspacePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/script" element={<ScriptPage />} />
          <Route path="/group-ops" element={<GroupOpsPage />} />
          <Route path="/nurture" element={<NurturePlanPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/cloud-phone" element={<CloudPhonePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/logs" element={<LogCenterPage />} />
          <Route path="*" element={<Navigate to={DEFAULT_NAV_PATH} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
