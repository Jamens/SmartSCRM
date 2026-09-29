import { useState } from 'react'
import {
  SETTLED_DETAIL_STATUS,
  type BatchDetailStatus,
  type BatchRecallBlocked,
  type RecallStatus
} from '@shared/batchSend'
import type { BadgeVariant } from './batchActions'
import {
  ACTION_LABEL,
  ACTIONS,
  recallEligible,
  STATUS_LABEL,
  STATUS_VARIANT,
  type BatchAction
} from './batchActions'
import type { BatchDetailVO } from '@/api/batchSend'
import { useBatchAction, useBatchDetails, useBatchRecall, useBatchRetry, useBatchTask } from '@/api/batchSend'
import { chatMs } from '@/api/messages'
import { chatClock } from '@shared/chatTime'
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

const SEND_STATUS_LABEL: Record<BatchDetailStatus, string> = {
  pending: '待发送',
  sending: '发送中',
  success: '成功',
  failed: '失败',
  unknown: '结果未知',
  skipped: '已跳过'
}

const RECALL_STATUS_LABEL: Record<RecallStatus, string> = {
  none: '未撤回',
  recalling: '撤回中',
  recalled: '已撤回',
  recall_failed: '撤回失败'
}

const SEND_STATUSES = Object.keys(SEND_STATUS_LABEL) as BatchDetailStatus[]
const RECALL_STATUSES = Object.keys(RECALL_STATUS_LABEL) as RecallStatus[]

/**
 * 两条判据答两个问题，不许合并：
 * - 行徽标读 `SETTLED_DETAIL_STATUS`（「人还能不能处置这一行」：success / unknown / skipped 算收口）；
 * - 「重发这一条」只认 `sendStatus === 'failed'`。
 * `failed` 一旦被算成收口，重试按钮就永远点不动；`success` 一旦被算成可重发，就会把已发出的再发一遍。
 * 泵该发谁永远不在这里——那一条只有主进程的 `buildQueues` 认 `pending`（shared 的同一段注释同口径）。
 */
function detailVariant(status: BatchDetailStatus): BadgeVariant {
  if (status === 'failed') return 'destructive'
  if (!SETTLED_DETAIL_STATUS.includes(status)) return 'secondary'
  return status === 'success' ? 'ghost' : 'outline'
}

const BODY_MAX = 60
const KEY_MAX = 16

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 墙钟串一律先 `chatMs` 补上写库那个偏移，再交给 `chatClock`：`dayjs(串)` 会在非东八区机器上偏一次。 */
function clockOf(value: string | null | undefined): string {
  return value ? chatClock(chatMs(value)) : '—'
}

/**
 * 「距今 N 秒」的算法。`nowMs` 用参数默认值取当下，与 `lib/chatDays.ts` 的 `listTime` / `dayLabel`
 * 同一条口径（渲染函数体里直接写 `Date.now()` 会撞 `react-hooks/purity` 那条 error 级规则）。
 * 每次重新渲染取一次当下，不自设定时器：页面收到 `batch:state` 就 invalidate + 重新 GET（Task 13 的
 * `useBatchLive`，挂在 `BroadcastPage` 上），这一句跟着跳；没人看的页面不养常驻定时器。
 */
function secondsSince(ms: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.round((nowMs - ms) / 1000))
}

export function BatchTaskDetail({ taskId }: { taskId: number }): React.JSX.Element {
  const { data: task, isPending: taskPending, isError: taskLoadFailed, error: taskLoadError } = useBatchTask(taskId)

  const [sendStatus, setSendStatus] = useState<string>(ALL)
  const [recallStatus, setRecallStatus] = useState<string>(ALL)
  const [page, setPage] = useState(1)
  const details = useBatchDetails(
    taskId,
    sendStatus === ALL ? undefined : sendStatus,
    recallStatus === ALL ? undefined : recallStatus,
    page
  )

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
  const retry = useBatchRetry()
  const recall = useBatchRecall()

  /**
   * 三个通道各说各的话，因为三种读数必须分得开：
   * - `failure`：这一跳没成（抛出来的那条：preload 未挂载 / IPC 被拒），红色；
   * - `resetResult`：复位回来了几条（0 也算回来了，只是没有可重发的），中性；
   * - `recallNote`：撤回计划回来了几条待撤、几条不能撤，中性。
   * `resetResult` 存数不存句子：那句「点继续重跑」要配的是**复位之后**的状态
   * （R11 的 done/error → paused 由 hook 里的 invalidate + GET 才落进缓存），
   * 在 mutate 回调里拼句子只会用上取数前的旧状态。
   */
  const [failure, setFailure] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ count: number; label: string } | null>(null)
  const [recallNote, setRecallNote] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<BatchRecallBlocked[]>([])
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const clearNotes = (): void => {
    setFailure(null)
    setResetResult(null)
    setRecallNote(null)
    setBlocked([])
  }

  const runAction = (kind: BatchAction): void => {
    clearNotes()
    actionByKind[kind].mutate(taskId, {
      // `null` = 这一跳没成（后端 40902/40404 拒绝、宿主不可达都会塌成 null），不是成功；
      // 徽标的真值仍由 hook 里的 invalidate + GET 追平。这里不自起泵——起泵是 batch:start/resume 处理器的活。
      onSuccess: (out) => {
        if (out === null) {
          setFailure(`「${ACTION_LABEL[kind]}」这一跳没成：后端拒绝或宿主不可达，任务保持原状。`)
        }
      },
      onError: (err) => setFailure(`「${ACTION_LABEL[kind]}」这一跳没成：${err.message}`)
    })
  }

  /** `detailIds` 省略＝整批（表头那颗），带＝只这一行（行末那颗）：同一跳端点，两种粒度（R11）。 */
  const doRetry = (detailIds: number[] | undefined, label: string): void => {
    clearNotes()
    retry.mutate({ taskId, detailIds }, {
      onSuccess: (reset) => setResetResult({ count: reset, label }),
      // 抛出来的这一路才是确证的"这一跳没成"；主进程 `batchApi.retryFailed` 把后端拒绝也塌成 0，
      // 所以 0 那一路只能陈述"没有可重发的"并把核对办法一起交给用户（见下面的渲染处）。
      onError: (err) => setFailure(`「重发」这一跳没成：${err.message}`)
    })
  }

  const doRecall = (): void => {
    if (selected.size === 0) return
    const detailIds = [...selected]
    clearNotes()
    recall.mutate({ taskId, detailIds }, {
      onSuccess: (out) => {
        // 被挡下的行后端不写库，`blocked[].reason` 是「这几条为什么没撤」的唯一出处：逐条点名，不压成计数。
        setBlocked(out.blocked)
        if (out.eligible === 0 && out.blocked.length === 0) {
          // 请求了 N 条却既没进撤回计划也没拿到一条理由＝这一跳没成（宿主把没有回来的 plan 塌成空结果）。
          setFailure(`撤回这一跳没成：选中的 ${detailIds.length} 条既没被接受也没被挡下，后端的结果没回来。`)
          return
        }
        setSelected(new Set())
        setRecallNote(`待撤 ${out.eligible} 条，${out.blocked.length} 条不能撤`)
      },
      onError: (err) => setFailure(`撤回这一跳没成：${err.message}`)
    })
  }

  const toggleRow = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (taskPending) {
    return <p className="py-8 text-center text-sm text-muted-foreground">加载任务中…</p>
  }
  if (taskLoadFailed || !task) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        任务加载失败：{taskLoadError?.message ?? '后端没有回这一条任务'}
      </p>
    )
  }

  const rows = details.data?.records ?? []
  const total = details.data?.total ?? 0
  const pageSize = details.data?.pageSize ?? 1
  const lastPage = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)))
  const goPage = (next: number): void => setPage(Math.min(Math.max(next, 1), lastPage))

  const pct = task.totalCount > 0 ? Math.min(100, Math.round((task.sentCount / task.totalCount) * 100)) : 0
  const acts = ACTIONS[task.status]
  // 复位把终态唤醒成 paused（R11），正常情况下「继续」就在那排按钮上；不在的时候必须说清点哪一颗，
  // 否则「点继续重跑」会是一句在卡片上点不动的话。
  const resumeStep = acts.includes('resume')
    ? ''
    : acts.includes('start')
      ? `（当前「${STATUS_LABEL[task.status]}」的卡片上没有「继续」，点「开始」才会重跑。）`
      : acts.includes('pause')
        ? `（当前「${STATUS_LABEL[task.status]}」的卡片上没有「继续」，先「暂停」再点「继续」才会重跑。）`
        : `（当前「${STATUS_LABEL[task.status]}」的卡片上没有重跑入口：这一批要等任务回到可执行状态。）`
  // 心跳是墙钟串：解析走 chatMs，显示走 chatClock（东八区 HH:mm），"距今"由它跟当下比。
  const heartbeatMs = task.heartbeatAt ? chatMs(task.heartbeatAt) : null
  const heartbeatAgo = heartbeatMs === null ? null : secondsSince(heartbeatMs)

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{task.name}</span>
          <Badge variant={STATUS_VARIANT[task.status]} className="text-[11px]">
            {STATUS_LABEL[task.status]}
          </Badge>
          {/* 演练徽标在详情里也常驻：跑完的演练任务不许看起来像真发过（spec §7）。 */}
          {task.dryRun ? (
            <Badge className="text-[11px]">演练</Badge>
          ) : (
            <Badge variant="outline" className="text-[11px]">
              真发
            </Badge>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {/* 0 也写「0」：留白会被读成"还没统计"，而它的意思是"一条没失败"。 */}
            共 {task.totalCount} · 已发 {task.sentCount} · 失败 {task.failCount}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {task.sentCount}/{task.totalCount}
          </span>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          心跳：
          {/* null = 这一条任务从没被泵碰过，空着会被读成"页面没刷出来"。 */}
          {heartbeatMs === null ? '还没跑过' : `${chatClock(heartbeatMs)} · 距今 ${heartbeatAgo} 秒`}
        </p>
        {/* 「距今 N 秒」才是"引擎还在跑"的那张证人：15 秒一跳在 HH:mm 刻度上看不出来。
            它不进定时器，页面每收到一次 `batch:state` 就重新 GET（Task 13 的 useBatchLive，挂在页面层），
            重新渲染时这个数自然跟着跳；没人看的页面不该养一个常驻定时器。 */}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {acts.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'cancel' ? 'destructive' : 'outline'}
              className="h-7 px-2 text-[11px]"
              onClick={() => runAction(action)}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
          {acts.length === 0 && <span className="text-xs text-muted-foreground">终态任务没有可执行的动作。</span>}
        </div>

        {resetResult && (
          <p className="mt-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
            {resetResult.count > 0 ? (
              // 复位本身不投泵：泵只在 running 时捡 pending 行（Task 12 的 runTask），
              // 少了这一句用户会以为点完就在跑。要不要"点继续"看的是复位之后 GET 回来的状态，不是取数前那一份。
              `已复位 ${resetResult.count} 条，点继续重跑` + resumeStep
            ) : (
              <>
                {`${resetResult.label}：这几条不是失败状态，没有可重发的。`}
                {/* 复位 0 条有两解：确实没有 failed 行，或者后端拒了这一跳（宿主把拒绝也塌成 0）。
                    分辨办法交给用户核对——明细里的「失败」徽标有没有变少。 */}
                <span className="text-muted-foreground">
                  （0 条也有可能是这一跳没成——后端拒绝时复位数同样回 0。看下面「失败」徽标的条数有没有变少来分辨。）
                </span>
              </>
            )}
          </p>
        )}
      </section>

      {failure && (
        <p className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">{failure}</p>
      )}

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Select
            value={sendStatus}
            onValueChange={(v) => {
              setSendStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部发送状态</SelectItem>
              {SEND_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEND_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={recallStatus}
            onValueChange={(v) => {
              setRecallStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部撤回状态</SelectItem>
              {RECALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RECALL_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => doRetry(undefined, '整批')}
            disabled={retry.isPending}
          >
            {retry.isPending ? '复位中…' : '重发失败条目'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={doRecall}
            disabled={recall.isPending || selected.size === 0 || task.dryRun}
          >
            {recall.isPending ? '撤回中…' : `撤回已发${selected.size > 0 ? `（${selected.size}）` : ''}`}
          </Button>

          <span className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
            <span>
              第 {details.data?.page ?? page} / {lastPage} 页 · 共 {total} 条
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => goPage(page - 1)}
              disabled={page <= 1}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => goPage(page + 1)}
              disabled={page >= lastPage}
            >
              下一页
            </Button>
          </span>
        </div>

        {task.dryRun && <p className="pb-2 text-xs text-muted-foreground">演练任务没有真发过</p>}
        {recallNote && (
          <p className="mb-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">
            {recallNote}
          </p>
        )}

        {blocked.length > 0 && (
          <details className="mb-2 rounded-md border border-border/60 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              这 {blocked.length} 条不能撤（被挡下的行后端不写库，这里就是唯一出处）
            </summary>
            <ul className="mt-2 space-y-1">
              {blocked.map((b) => (
                <li key={b.detailId} className="text-muted-foreground">
                  明细 #{b.detailId} — {b.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="min-h-0 overflow-auto">
          {details.isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载明细中…</p>
          ) : details.isError ? (
            <p className="py-8 text-center text-sm text-destructive">明细加载失败：{details.error.message}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">这一页没有符合筛选条件的明细。</p>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <Th className="w-8">撤</Th>
                  <Th className="w-12">seq</Th>
                  <Th className="w-14">账号</Th>
                  <Th>chatKey</Th>
                  <Th className="w-16">内容</Th>
                  <Th className="min-w-[16rem]">正文</Th>
                  <Th className="w-20">发送</Th>
                  <Th className="min-w-[12rem]">错误</Th>
                  <Th className="min-w-[10rem]">msgKey</Th>
                  <Th className="w-28">撤回</Th>
                  <Th className="w-16">发出</Th>
                  <Th className="w-28">操作</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <DetailRow
                    key={row.id}
                    row={row}
                    canRecall={recallEligible(task, row)}
                    checked={selected.has(row.id)}
                    onToggle={() => toggleRow(row.id)}
                    onRetry={() => doRetry([row.id], `明细 #${row.id}`)}
                    retrying={retry.isPending}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

/** 一行明细：勾选（撤回）、徽标（收口口径）、重发那颗（只认 failed）、三个截断单元格都在这。 */
function DetailRow({
  row,
  canRecall,
  checked,
  onToggle,
  onRetry,
  retrying
}: {
  row: BatchDetailVO
  canRecall: boolean
  checked: boolean
  onToggle: () => void
  onRetry: () => void
  retrying: boolean
}): React.JSX.Element {
  return (
    <tr className="align-top">
      <Td className="w-8">
        {/* checkbox 只挂在 recallEligible 的行上；演练任务整列禁用，表头另有那句说明。
            过了判据的旧勾选（比如刚被推成 recalling）画不出来也点不动。 */}
        <input
          type="checkbox"
          className="mt-1 size-3.5 accent-[oklch(0.488_0.243_264.376)] disabled:cursor-not-allowed"
          checked={canRecall && checked}
          disabled={!canRecall}
          onChange={onToggle}
          aria-label={`撤回明细 ${row.seq}`}
        />
      </Td>
      <Td className="w-12 tabular-nums">{row.seq}</Td>
      <Td className="w-14 tabular-nums">{row.accountId}</Td>
      <Td className="max-w-[14rem] truncate" title={row.chatKey}>
        {row.chatKey}
      </Td>
      <Td className="w-16" title={`contentIndex=${row.contentIndex}`}>
        第 {row.contentIndex + 1} 条
      </Td>
      <Td className="max-w-[22rem] break-words" title={row.body}>
        {truncate(row.body, BODY_MAX)}
      </Td>
      <Td className="w-20">
        <Badge variant={detailVariant(row.sendStatus)} className="text-[11px]">
          {SEND_STATUS_LABEL[row.sendStatus]}
        </Badge>
      </Td>
      <Td
        className="max-w-[18rem] break-words text-muted-foreground"
        title={[row.errorCode, row.errorDetail].filter(Boolean).join(' · ')}
      >
        {row.errorCode ? `${row.errorCode}${row.errorDetail ? ` · ${truncate(row.errorDetail, 40)}` : ''}` : '—'}
      </Td>
      <Td className="max-w-[14rem] break-all text-muted-foreground" title={row.msgKey ?? ''}>
        {row.msgKey ? truncate(row.msgKey, KEY_MAX) : '—'}
      </Td>
      <Td className="w-28 text-muted-foreground">
        {RECALL_STATUS_LABEL[row.recallStatus]}
        {row.recallDetail && (
          <span className="block truncate" title={row.recallDetail}>
            {row.recallDetail}
          </span>
        )}
      </Td>
      <Td className="w-16 tabular-nums text-muted-foreground">{clockOf(row.sentAt)}</Td>
      <Td className="w-28">
        {/* 这一颗只认 failed，不读上面那条收口判据：两条判据一合并，按钮就永远点不动。 */}
        {row.sendStatus === 'failed' ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={onRetry}
            disabled={retrying}
          >
            重发这一条
          </Button>
        ) : row.sendStatus === 'unknown' ? (
          // R3：V1 不给 unknown 任何复位/裁决入口——它可能已经发出去了，重发就是往客户脸上发两遍。
          <span className="text-[11px] leading-tight text-muted-foreground">
            结果未知（可能已发出），不自动重发
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </Td>
    </tr>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <th className={`border-b border-border/40 px-2 py-1.5 font-medium ${className}`}>{children}</th>
}

function Td({
  children,
  className = '',
  title
}: {
  children: React.ReactNode
  className?: string
  title?: string
}): React.JSX.Element {
  return (
    <td title={title} className={`border-b border-border/30 px-2 py-1.5 text-foreground/90 ${className}`}>
      {children}
    </td>
  )
}
