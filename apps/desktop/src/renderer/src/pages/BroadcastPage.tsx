import { useState } from 'react'
import { ArrowLeft, Megaphone, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBatchLive } from '@/api/batchSend'
import { BatchTaskDetail } from '@/components/broadcast/BatchTaskDetail'
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
          <BatchTaskDetail taskId={openTaskId} />
        )}
      </div>

      {wizardOpen && <BatchWizard onClose={() => setWizardOpen(false)} onOpen={setOpenTaskId} />}
    </div>
  )
}
