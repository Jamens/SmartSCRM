import { useRef } from 'react'
import { LoaderCircle, MonitorOff, RotateCw } from 'lucide-react'
import { platformOf } from '@/lib/platform'
import { isElectron } from '@/services/viewService'
import { useWebContentsView, type ActiveView } from '@/hooks/useWebContentsView'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { PlatformAccount } from '@/stores/accounts'

interface Props {
  account: PlatformAccount | null
}

export default function AccountStage({ account }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const meta = account ? platformOf(account.platformType) : null
  const embedUrl = meta?.embedUrl ?? null

  const active: ActiveView | null =
    account && embedUrl ? { viewId: account.viewId, url: embedUrl } : null
  const { loading, reload } = useWebContentsView(containerRef, active)

  if (!account) {
    return (
      <StageEmpty
        title="尚未选择账号"
        description="从左侧列表选择一个平台账号，即可在此内嵌登录并管理会话。"
      />
    )
  }

  const Icon = meta?.icon ?? MonitorOff

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
        <span
          className="flex size-8 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: meta?.color }}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">{meta?.hint}</p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span
            className={`size-1.5 rounded-full ${account.status === 1 ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
          />
          {account.status === 1 ? '在线' : '离线'}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          onClick={reload}
          disabled={!isElectron || !embedUrl}
          title="刷新页面"
        >
          <RotateCw className="size-4" />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {embedUrl && isElectron ? (
          <div ref={containerRef} className="absolute inset-0 rounded-b-xl" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <MonitorOff className="size-6 text-muted-foreground" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              {!isElectron
                ? '当前在浏览器预览，内嵌视图仅在桌面端可用。'
                : `${meta?.label} 暂不支持网页内嵌登录。`}
            </p>
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground/90 px-3 py-1.5 text-xs text-background shadow-lg">
            <LoaderCircle className="size-3.5 animate-spin" />
            页面加载中…
          </div>
        )}
      </div>
    </section>
  )
}

function StageEmpty({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <section className="flex h-full flex-1 items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MonitorOff className="size-7" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
