import { useState } from 'react'
import { ArrowLeft, Megaphone, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useBatchLive, useBatchTask } from '@/api/batchSend'
import { BatchTaskList } from '@/components/broadcast/BatchTaskList'
import { BatchWizard } from '@/components/broadcast/BatchWizard'

export function BroadcastPage(): React.JSX.Element {
  // 事件只是加速器，真值靠 GET：这一句挂的是 Task 13 的 `useBatchLive`（spec §7 的落点）。
  useBatchLive()
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Megaphone className="size-5 text-primary" />
            批量群发
          </h1>
          <p className="text-xs text-muted-foreground">按账号建任务，演练先行；真实发送由任务上的「开始」触发</p>
        </div>
        <div className="flex items-center gap-2">
          {openTaskId !== null && (
            <Button size="sm" variant="outline" onClick={() => setOpenTaskId(null)}>
              <ArrowLeft className="size-4" />
              返回列表
            </Button>
          )}
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="size-4" />
            新建任务
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {openTaskId === null ? (
          <BatchTaskList onOpen={setOpenTaskId} />
        ) : (
          <TaskDetailPlaceholder taskId={openTaskId} />
        )}
      </div>

      {wizardOpen && <BatchWizard onClose={() => setWizardOpen(false)} onOpen={setOpenTaskId} />}
    </div>
  )
}

/** 详情视图（明细表 / 重发 / 撤回）是 Task 15 的落点；这里先把切换的缝与头部卡挂上。 */
function TaskDetailPlaceholder({ taskId }: { taskId: number }): React.JSX.Element {
  const { data: task, isPending, isError, error } = useBatchTask(taskId)
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      {isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">加载任务中…</p>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">任务加载失败：{error.message}</p>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{task.name}</span>
          <Badge variant="secondary" className="text-[11px]">
            {task.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {task.sentCount}/{task.totalCount} · 失败 {task.failCount}
          </span>
          <span>{task.dryRun ? <Badge className="text-[11px]">演练</Badge> : <Badge variant="outline" className="text-[11px]">真发</Badge>}</span>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        明细表、失败重发与撤回勾选在下一任务接入（Task 15：BatchTaskDetail）。
      </p>
    </div>
  )
}
