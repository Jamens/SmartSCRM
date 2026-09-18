import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth'
import TitleBar from '@/components/TitleBar'
import LoginPage from '@/pages/LoginPage'
import HomePage from '@/pages/HomePage'
import { LoaderCircle } from 'lucide-react'

function App(): React.JSX.Element {
  const phase = useAuthStore((s) => s.phase)
  const boot = useAuthStore((s) => s.boot)
  const logout = useAuthStore((s) => s.logout)

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
    <div className="flex h-screen flex-col">
      <TitleBar onLogout={() => void logout()} />
      <HomePage />
    </div>
  )
}

export default App
