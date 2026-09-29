import { useState } from 'react'
import type { BatchTaskStatus } from '@shared/batchSend'
import {
  ACTION_LABEL,
  ACTIONS,
  STATUS_LABEL,
  STATUS_VARIANT,
  type BatchAction
} from './batchActions'
import type { BatchTaskVO } from '@/api/batchSend'
import { useBatchAction, useBatchTasks } from '@/api/batchSend'
import { chatMs } from '@/api/messages'
import { chatClock, chatDayKey } from '@shared/chatTime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const ALL = 'all'
const STATUSES = Object.keys(STATUS_LABEL) as BatchTaskStatus[]

function formatCreatedAt(createdAt: string | null | undefined): string {
  if (!createdAt) return '—'
  return `${chatDayKey(chatMs(createdAt))} ${chatClock(chatMs(createdAt))}`
}

export function BatchTaskList({ onOpen }: { onOpen: (taskId: number) => void }): React.JSX.Element {
  const [status, setStatus] = useState<string>(ALL)
  const { data, isPending, isError, error } = useBatchTasks(status === ALL ? undefined : status)

  const startAction = useBatchAction('start')
  const pauseAction = useBatchAction('pause')
  const resumeAction = useBatchAction('resume')
  const cancelAction = useBatchAction('cancel')
  const actionByKind: Record<BatchAction, typeof startAction> = {
    start: startAction,
    pause: pauseAction,
    resume: resumeAction,
    cancel: cancelAction
  }
  const [notice, setNotice] = useState<string | null>(null)

  const runAction = (kind: BatchAction, taskId: number): void => {
    setNotice(null)
    actionByKind[kind].mutate(taskId, {
      // `null` = 这一跳没成（后端 40902/40404 拒绝、网关挂了、断网都会塌成 null），不是成功；
      // 只有拿到 BatchProgress 才算成了——徽标的真值仍由 hook 里的 invalidate + GET 追平。
      onSuccess: (out) => {
        if (out === null) {
          setNotice(`「${ACTION_LABEL[kind]}」这一跳没成：后端拒绝或宿主不可达，列表保持原状。`)
        }
      },
      onError: (err) => {
        setNotice(`「${ACTION_LABEL[kind]}」这一跳没成：${err.message}`)
      }
    })
  }

  const tasks = data?.records ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 pb-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && <span className="text-xs text-muted-foreground">共 {data.total} 个任务</span>}
      </div>

      {notice && <p className="mb-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">{notice}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        {isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载任务列表中…</p>
        ) : isError ? (
          <p className="py-16 text-center text-sm text-muted-foreground">任务列表加载失败：{error.message}</p>
        ) : tasks.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">还没有群发任务，点击右上角「新建任务」。</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,2fr)_72px_56px_minmax(0,1.6fr)_48px_128px_minmax(0,168px)] gap-3 px-3 text-[11px] text-muted-foreground">
              <span>任务名</span>
              <span>状态</span>
              <span>模式</span>
              <span>进度</span>
              <span className="text-right">失败</span>
              <span>创建时间</span>
              <span className="text-right">操作</span>
            </div>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={onOpen} onAction={runAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  onOpen,
  onAction
}: {
  task: BatchTaskVO
  onOpen: (taskId: number) => void
  onAction: (kind: BatchAction, taskId: number) => void
}): React.JSX.Element {
  const pct = task.totalCount > 0 ? Math.min(100, Math.round((task.sentCount / task.totalCount) * 100)) : 0
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid cursor-pointer grid-cols-[minmax(0,2fr)_72px_56px_minmax(0,1.6fr)_48px_128px_minmax(0,168px)] items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm hover:bg-accent/40"
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        // 空格在 div[role=button] 上默认还会滚页面，不拦住就"打开了但也跳了一段"。
        if (e.key === ' ') e.preventDefault()
        if (e.key === 'Enter' || e.key === ' ') onOpen(task.id)
      }}
    >
      <span className="min-w-0 truncate font-medium text-foreground">{task.name}</span>
      <span>
        <Badge variant={STATUS_VARIANT[task.status]} className="text-[11px]">
          {STATUS_LABEL[task.status]}
        </Badge>
      </span>
      {/* 演练徽标常驻：两种状态都有字，跑完的演练任务不许看起来像真发过（spec §7）。 */}
      <span>{task.dryRun ? <Badge className="text-[11px]">演练</Badge> : <Badge variant="outline" className="text-[11px]">真发</Badge>}</span>
      <span className="flex items-center gap-2">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {task.sentCount}/{task.totalCount}
        </span>
      </span>
      {/* 0 也写「0」：留白会被读成"还没统计"，而它的意思是"一条没失败"。 */}
      <span className="text-right tabular-nums">{task.failCount}</span>
      <span className="text-xs text-muted-foreground">{formatCreatedAt(task.createdAt)}</span>
      <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {ACTIONS[task.status].map((action) => (
          <Button
            key={action}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onAction(action, task.id)}
          >
            {ACTION_LABEL[action]}
          </Button>
        ))}
      </span>
    </div>
  )
}
