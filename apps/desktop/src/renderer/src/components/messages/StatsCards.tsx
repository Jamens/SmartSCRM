// src/renderer/src/components/messages/StatsCards.tsx
import { useState } from 'react'
import { Inbox, MessagesSquare, Send, Users } from 'lucide-react'
import { useMessageStats } from '@/api/messages'
import { BAR_DAYS, shareOf, toBars } from '@/lib/chatStats'
import { cn } from '@/lib/utils'

type StatsWindow = 7 | 30

const BAR_HEIGHT_PX = 40

function Metric({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/**
 * 纯读页：四个数与七根柱子全部来自 `GET /api/messages/stats`（Task 4），这里不做任何二次统计。
 * 不引图表库——四根数字加七根柱子 div 就够，而多一个依赖就要多过一次 C2 红线审计。
 */
export default function StatsCards({ accountId }: { accountId: number | null }): React.JSX.Element {
  const [days, setDays] = useState<StatsWindow>(7)
  const { data, isPending, isError } = useMessageStats(accountId, days)
  const bars = toBars(data?.perDay ?? [])

  return (
    /**
     * `data-p6-stats-window` 两头都给：容器上是**当前生效**的那一个值（读一份属性就知道现在是 7 还是 30），
     * 两个按钮上是**各自的**值（可切换的入口）。计划的 Interfaces 那句把
     * 「`data-p6-stats-window="7|30"`」和「`data-p6-stats="cards"`」写在同一句"DOM 上带"里，读起来像容器，
     * 而 Step 4 的代码片段落在按钮上——两处都留，后面任何一侧读法都能拿到值。
     * 消费侧口径：**要"当前窗口"读容器，要"切换入口"点按钮**，别用 `querySelector` 的第一个命中猜。
     * 尤其别拿裸属性选择器去点：两边属性名相同，容器文档序在前，`[data-p6-stats-window="30"]` 在
     * `days===30` 时命中的是容器——点上去什么都不会发生，却照样过 hit-test。要点就写全
     * `button[data-p6-stats-window="30"]`。
     */
    <div
      data-p6-stats="cards"
      data-p6-stats-window={days}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/60 px-6 py-2.5"
    >
      <div className="flex items-center gap-1">
        {([7, 30] as StatsWindow[]).map((w) => (
          <button
            key={w}
            type="button"
            data-p6-stats-window={w}
            onClick={() => setDays(w)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              days === w
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            {w} 天
          </button>
        ))}
      </div>

      {accountId === null && <span className="text-xs text-muted-foreground">选一个账号看统计。</span>}
      {accountId !== null && isPending && <span className="text-xs text-muted-foreground">统计加载中…</span>}
      {accountId !== null && isError && (
        <span className="text-xs text-destructive">统计读取失败，请确认后端已启动。</span>
      )}

      {data && (
        <>
          <Metric icon={<MessagesSquare className="size-3.5" />} label="消息" value={String(data.total)} />
          <Metric
            icon={<Inbox className="size-3.5" />}
            label="收到"
            value={`${data.inCount} · ${shareOf(data.inCount, data.total)}`}
          />
          <Metric
            icon={<Send className="size-3.5" />}
            label="发出"
            value={`${data.outCount} · ${shareOf(data.outCount, data.total)}`}
          />
          <Metric
            icon={<Users className="size-3.5" />}
            label="活跃会话"
            value={String(data.activeConversations)}
          />
          <div className="flex items-end gap-1.5">
            {bars.map((bar) => (
              <div key={bar.day} className="flex w-6 flex-col items-center gap-1">
                <div
                  data-p6-bar={bar.day}
                  className="flex w-2 flex-col justify-end overflow-hidden rounded-sm bg-muted"
                  style={{ height: BAR_HEIGHT_PX }}
                  title={`${bar.day} 收 ${bar.inCount} 发 ${bar.outCount}`}
                >
                  {/* 里层的百分比是"占这一根柱子"的：外层已经按 heightPct 缩过，两段加起来正好铺满。 */}
                  <div className="flex flex-col justify-end" style={{ height: `${bar.heightPct}%` }}>
                    <div className="w-full bg-primary/35" style={{ height: `${bar.outShare}%` }} />
                    <div className="w-full bg-primary" style={{ height: `${bar.inShare}%` }} />
                  </div>
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">{bar.label}</span>
              </div>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">近 {BAR_DAYS} 天：实心收到 / 浅色发出</span>
        </>
      )}
    </div>
  )
}
