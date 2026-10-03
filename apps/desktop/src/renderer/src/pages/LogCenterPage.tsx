import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderOpen, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  LOG_CATEGORIES,
  type LogCategory,
  type LogEntry,
  type LogLevel
} from '@shared/log'
import { useLogs } from '@/lib/logs'
import { cn } from '@/lib/utils'

const LEVELS: Array<LogLevel | 'all'> = ['all', 'debug', 'info', 'warn', 'error']

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-amber-300',
  error: 'text-red-400'
}

const CATEGORY_STYLE: Record<LogCategory, string> = {
  app: 'bg-sky-500/15 text-sky-300',
  ipc: 'bg-violet-500/15 text-violet-300',
  bridge: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-red-500/15 text-red-300'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function LogCenterPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [category, setCategory] = useState<LogCategory | 'all'>('all')
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const { entries, loading, host, refresh, clear, openFolder } = useLogs(category, level)

  if (host === 'browser') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Header onRefresh={refresh} onOpenFolder={openFolder} onClear={clear} category={category} level={level} setCategory={setCategory} setLevel={setLevel} />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            {t('log.browserNote')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <Header
        onRefresh={refresh}
        onOpenFolder={openFolder}
        onClear={clear}
        category={category}
        level={level}
        setCategory={setCategory}
        setLevel={setLevel}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Card className="h-full">
          <CardContent className="h-full p-0">
            {loading && entries.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground" data-testid="log-loading">
                {t('log.loading')}
              </p>
            ) : entries.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground" data-testid="log-empty">
                {t('log.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-border/50 font-mono text-xs" data-testid="log-list">
                {entries.map((e) => (
                  <LogRow key={e.id} entry={e} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(entry.ts)}</span>
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
          CATEGORY_STYLE[entry.category]
        )}
      >
        {entry.category}
      </span>
      <span className={cn('shrink-0 uppercase', LEVEL_STYLE[entry.level])}>{entry.level}</span>
      <span className="min-w-0 break-all text-foreground">{entry.message}</span>
    </li>
  )
}

function Header({
  onRefresh,
  onOpenFolder,
  onClear,
  category,
  level,
  setCategory,
  setLevel
}: {
  onRefresh: () => void
  onOpenFolder: () => void
  onClear: () => void
  category: LogCategory | 'all'
  level: LogLevel | 'all'
  setCategory: (v: LogCategory | 'all') => void
  setLevel: (v: LogLevel | 'all') => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="size-5 text-primary" />
          {t('log.title')}
        </h1>
        <p className="text-xs text-muted-foreground">
          {t('log.desc')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('log.filterByCategory')}
          value={category}
          onChange={(e) => setCategory(e.target.value as LogCategory | 'all')}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          data-testid="log-category"
        >
          <option value="all">{t('log.allCategories')}</option>
          {LOG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label={t('log.filterByLevel')}
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          data-testid="log-level"
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? t('log.allLevels') : l}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          {t('log.refresh')}
        </button>
        <button
          type="button"
          onClick={onOpenFolder}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          <FolderOpen className="size-3.5" />
          {t('log.openFolder')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          data-testid="log-clear"
        >
          <Trash2 className="size-3.5" />
          {t('log.clear')}
        </button>
      </div>
    </header>
  )
}
