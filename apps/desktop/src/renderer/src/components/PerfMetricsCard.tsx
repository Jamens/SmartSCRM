import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePerfMetrics } from '@/lib/perfMetrics'

/**
 * 内存/性能监控（A7）——设置页里的一节。数值与行序来自 `@shared/perf`（纯逻辑，有单测），
 * 这里只画。按主进程视角展示：渲染层自己的堆不在这个进程里，见 `main/services/perfMetrics.ts` 头注。
 */
export default function PerfMetricsCard(): React.JSX.Element {
  const { t } = useTranslation()
  const { rows, loading } = usePerfMetrics()

  return (
    <Card data-testid="perf-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          {t('settings.perf')}
        </CardTitle>
        <CardDescription>{t('settings.perfDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3">
                <dt className="truncate text-xs text-muted-foreground">{r.label}</dt>
                <dd className="shrink-0 text-xs font-medium text-foreground">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
