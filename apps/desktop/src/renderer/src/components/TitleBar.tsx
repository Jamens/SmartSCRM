import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TitleBarProps {
  onLogout?: () => void
}

export default function TitleBar({ onLogout }: TitleBarProps): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const inElectron = Boolean(window.scrm)

  useEffect(() => {
    if (!inElectron) return
    void window.scrm?.win.isMaximized().then(setMaximized)
    return window.scrm?.win.onMaximizedChanged(setMaximized)
  }, [inElectron])

  if (!inElectron) return null

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between bg-primary select-none">
      <div className="flex items-center gap-2 pl-3">
        <div className="flex size-5 items-center justify-center rounded-md bg-gold/90">
          <Sparkles className="size-3 text-gold-foreground" />
        </div>
        <span className="text-sm font-semibold tracking-wide text-primary-foreground">SmartSCRM</span>
      </div>
      <div className="no-drag flex h-full">
        {onLogout && (
          <button
            onClick={onLogout}
            className="px-3 text-xs text-primary-foreground/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            退出登录
          </button>
        )}
        <button
          onClick={() => void window.scrm?.win.minimize()}
          className="flex h-full w-11 items-center justify-center text-primary-foreground/90 transition-colors hover:bg-white/15"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={() => void window.scrm?.win.toggleMaximize()}
          className="flex h-full w-11 items-center justify-center text-primary-foreground/90 transition-colors hover:bg-white/15"
        >
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>
        <button
          onClick={() => void window.scrm?.win.close()}
          className={cn(
            'flex h-full w-12 items-center justify-center text-primary-foreground/90 transition-colors',
            'hover:bg-destructive hover:text-white'
          )}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
