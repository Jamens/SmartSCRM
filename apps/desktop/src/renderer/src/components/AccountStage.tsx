import { useRef, useState } from 'react'
import { Languages, LoaderCircle, MonitorOff, RotateCw, SlidersHorizontal } from 'lucide-react'
import { platformOf } from '@/lib/platform'
import { useBridgeOf } from '@/lib/liveTailSync'
import { isElectron } from '@/services/viewService'
import { useWebContentsView, type ActiveView } from '@/hooks/useWebContentsView'
import { useAuthStore } from '@/stores/auth'
import { API_BASE } from '@/lib/http'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import ConversationSettingsDialog from '@/components/translation/ConversationSettingsDialog'
import type { PlatformAccount } from '@/stores/accounts'

interface Props {
  account: PlatformAccount | null
}

export default function AccountStage({ account }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [injectOn, setInjectOn] = useState(true)
  const inviteCode = useAuthStore((s) => s.user?.inviteCode) ?? ''
  const meta = account ? platformOf(account.platformType) : null
  const embedUrl = meta?.embedUrl ?? null
  const canInject = isElectron && embedUrl && meta?.channel && injectOn

  const active: ActiveView | null =
    account && embedUrl
      ? {
          viewId: account.viewId,
          url: embedUrl,
          channel: canInject ? meta?.channel : undefined,
          injectConfig: {
            webviewId: account.viewId,
            inviteCode,
            apiBase: API_BASE,
            previewEnabled: true
          }
        }
      : null
  const { loading, reload } = useWebContentsView(containerRef, active)

  // P-02：活动会话从既有那条链上来（按 accountId 筛 + 只有 `ready` 才算数），不新建 hook。
  // 桥不在、或挑到的那条 `activeChatKey === null`，都落到同一个禁用条件——后者在桥掉线时本就是 null，
  // 两个条件同源。不能拿"最后一条"或"任意一条"：多个账号视图同时在线（最多 7 个）时
  // 那会把语向写到另一个账号的同名会话上（spec §6）。
  const stageAccountId = account?.id ?? null
  const bridge = useBridgeOf(stageAccountId)
  const activeChatKey = bridge?.activeChatKey ?? null
  const [settingsOpen, setSettingsOpen] = useState(false)

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
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          data-p7-stage-settings=""
          disabled={activeChatKey === null}
          title={activeChatKey === null ? '会话未在线' : '为当前会话设置语向与线路'}
          onClick={() => setSettingsOpen(true)}
        >
          <SlidersHorizontal className="size-4" />
          会话设置
        </Button>
        <Button
          variant={injectOn ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5"
          onClick={() => setInjectOn((v) => !v)}
          disabled={!isElectron || !embedUrl}
          title="注入增强脚本（悬浮标识 / 后续翻译能力）"
        >
          <Languages className="size-4" />
          注入{injectOn ? '开' : '关'}
        </Button>
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

      {/* 拿不到 chatKey 就不挂载（spec §7）：禁用态已经把入口挡住了，这里再挡一次是为了让
          "弹层里揣着一条空会话键"这种状态在代码里不存在。`account.id` 就是后端那列
          `platform_account.id`（= `accountId`），不是 `account.viewId`。
          key 带上会话：换会话要让弹层重挂并重新铺一次表单——`activeChatKey` 是主进程推来的活值，
          而 Radix 的模态挡不住下面那颗原生视图，用户能在弹层开着时点进另一条会话；不重挂的话
          `draft` 还揣着上一条会话的值，保存就会把它写到新会话的键上。 */}
      {stageAccountId !== null && activeChatKey !== null && (
        <ConversationSettingsDialog
          key={`${stageAccountId}:${activeChatKey}`}
          accountId={stageAccountId}
          chatKey={activeChatKey}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
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
