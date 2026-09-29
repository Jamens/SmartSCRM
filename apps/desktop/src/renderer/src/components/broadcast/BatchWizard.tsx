import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PlatformType } from '@/lib/platform'
import { useAccounts, type PlatformAccount } from '@/stores/accounts'
import { flattenConversations, useConversations, type ConversationVO } from '@/api/messages'
import { useAudienceCustomers, useAudiences } from '@/api/audiences'
import {
  useBatchPreview,
  useCreateBatchTask,
  type BatchCreateInput,
  type BatchCreateVO
} from '@/api/batchSend'

type WizardStep = 'accounts' | 'recipients' | 'contents' | 'pacing' | 'confirm'

const STEPS: WizardStep[] = ['accounts', 'recipients', 'contents', 'pacing', 'confirm']
const STEP_LABEL: Record<WizardStep, string> = {
  accounts: '账号',
  recipients: '收件人',
  contents: '内容',
  pacing: '节律',
  confirm: '确认'
}

// 这四个数与后端 `BatchRules` 是同一份规则的两处写法（MAX_BODY=5000 / isSendable），
// 这里不许自造第三个数；文案同一条口径。
const MAX_CONTENTS = 20
const MAX_BODY = 5000
const MAX_TOTAL_DETAILS = 20000
const REAL_MIN_MSG_INTERVAL = 3
const REAL_MIN_CHAT_INTERVAL = 5
const RECIPIENT_FETCH_SIZE = 200
const PREVIEW_RECIPIENTS = 5

interface Recipient {
  accountId: number
  chatKey: string
  title: string | null
  customerId: number | null
}

const recipientKey = (r: { accountId: number; chatKey: string }): string => `${r.accountId}:${r.chatKey}`

const toRecipient = (c: ConversationVO): Recipient => ({
  accountId: c.accountId,
  chatKey: c.chatKey,
  title: c.title,
  customerId: c.customerId
})

function matchesQuery(conversation: ConversationVO, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (conversation.title ?? '').toLowerCase().includes(needle) || conversation.chatKey.toLowerCase().includes(needle)
}

const NONE = 'none'

export function BatchWizard({
  onClose,
  onOpen
}: {
  onClose: () => void
  onOpen: (taskId: number) => void
}): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('accounts')
  const [accountIds, setAccountIds] = useState<number[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [q, setQ] = useState('')
  const [audienceKey, setAudienceKey] = useState<string>(NONE)
  const [contents, setContents] = useState<string[]>([''])
  const [msgMin, setMsgMin] = useState(5)
  const [msgMax, setMsgMax] = useState(15)
  const [chatMin, setChatMin] = useState(30)
  const [chatMax, setChatMax] = useState(90)
  const [dryRun, setDryRun] = useState(true)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<BatchCreateVO | null>(null)

  const { data: accounts = [] } = useAccounts()
  const onlineWhatsapp = accounts.filter((a) => a.platformType === PlatformType.WhatsApp && a.status === 1)

  const { data: audiences = [] } = useAudiences()
  const audienceId = audienceKey === NONE ? null : Number(audienceKey)
  const pickedAudience = audiences.find((a) => a.id === audienceId) ?? null
  // R10：人群包只用来算命中集合，取件器仍只认 conversations；一屏取全量靠 customerCount 定 pageSize。
  const { data: audienceCustomers } = useAudienceCustomers(audienceId, 1, Math.max(pickedAudience?.customerCount ?? 1, 1))
  const audienceCustomerIds = useMemo(
    () => new Set((audienceCustomers?.records ?? []).map((c) => c.id)),
    [audienceCustomers]
  )

  const preview = useBatchPreview()
  const create = useCreateBatchTask()

  /** 预览的输入只有收件人与内容这两列：任一被改，上一份渲染结果（或那一次的失败）就不再代表当前。 */
  const dropPreview = (): void => {
    if (preview.data || preview.isError || preview.isPending) preview.reset()
  }
  const editRecipients = (next: (prev: Recipient[]) => Recipient[]): void => {
    dropPreview()
    setRecipients(next)
  }
  const editContents = (next: (prev: string[]) => string[]): void => {
    dropPreview()
    setContents(next)
  }

  const selectedKeys = useMemo(() => new Set(recipients.map(recipientKey)), [recipients])
  const contentErrors = contents.map((c, i) => {
    if (c.trim() === '') return `第 ${i + 1} 条为空`
    if (c.length > MAX_BODY) return `第 ${i + 1} 条超过 ${MAX_BODY} 字`
    return null
  })
  const contentsValid = contents.length > 0 && contentErrors.every((e) => e === null)
  const total = recipients.length * contents.length
  const overCap = total > MAX_TOTAL_DETAILS
  const realFloorViolated = !dryRun && (msgMin < REAL_MIN_MSG_INTERVAL || chatMin < REAL_MIN_CHAT_INTERVAL)

  const toggleAccount = (id: number): void => {
    if (accountIds.includes(id)) {
      setAccountIds(accountIds.filter((x) => x !== id))
      editRecipients((prev) => prev.filter((r) => r.accountId !== id))
    } else {
      setAccountIds([...accountIds, id])
    }
  }

  const toggleRecipient = (r: Recipient): void => {
    editRecipients((prev) => {
      const key = recipientKey(r)
      return prev.some((x) => recipientKey(x) === key) ? prev.filter((x) => recipientKey(x) !== key) : [...prev, r]
    })
  }

  const canNext = (): boolean => {
    switch (step) {
      case 'accounts':
        return accountIds.length > 0
      case 'recipients':
        return recipients.length > 0 && !overCap
      case 'contents':
        return contentsValid
      case 'pacing':
        return !realFloorViolated
      case 'confirm':
        return false
    }
  }

  const goNext = (): void => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1 && canNext()) setStep(STEPS[idx + 1])
  }

  const goBack = (): void => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  const submit = (): void => {
    const input: BatchCreateInput = {
      name: name.trim(),
      platform: 'whatsapp',
      dryRun,
      accountIds,
      conversations: recipients.map((r) => ({ accountId: r.accountId, chatKey: r.chatKey })),
      contents,
      msgIntervalMin: msgMin,
      msgIntervalMax: msgMax,
      chatIntervalMin: chatMin,
      chatIntervalMax: chatMax
    }
    create.mutate(input, {
      onSuccess: (out) => {
        // R8：部分接受必须看得见，不许静默丢——先弹被跳过清单，再进任务。
        if (out.rejected.length > 0) {
          setCreated(out)
        } else {
          onOpen(out.taskId)
          onClose()
        }
      }
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建群发任务</DialogTitle>
          <DialogDescription>五步：{STEPS.map((s) => STEP_LABEL[s]).join(' → ')}。演练模式默认开启，不会真的发消息。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={
                s === step
                  ? 'rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground'
                  : STEPS.indexOf(step) > i
                    ? 'rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground'
                    : 'rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground'
              }
            >
              {STEP_LABEL[s]}
            </span>
          ))}
        </div>

        <div className="max-h-[56vh] min-h-0 overflow-auto pr-1">
          {created ? (
            <RejectedPanel result={created} />
          ) : step === 'accounts' ? (
            <AccountsStep accounts={onlineWhatsapp} selected={accountIds} onToggle={toggleAccount} />
          ) : step === 'recipients' ? (
            <RecipientsStep
              accounts={onlineWhatsapp.filter((a) => accountIds.includes(a.id))}
              q={q}
              onQChange={setQ}
              audienceKey={audienceKey}
              onAudienceChange={setAudienceKey}
              audiences={audiences}
              audienceCustomerIds={audienceCustomerIds}
              audienceActive={audienceId !== null}
              selectedKeys={selectedKeys}
              onToggle={toggleRecipient}
              summary={`已选 ${recipients.length} 人 × ${contents.length} 条内容 = ${total} 条`}
              overCap={overCap}
            />
          ) : step === 'contents' ? (
            <ContentsStep
              contents={contents}
              errors={contentErrors}
              onChange={(i, v) => editContents((prev) => prev.map((c, idx) => (idx === i ? v : c)))}
              onAdd={() => editContents((prev) => (prev.length < MAX_CONTENTS ? [...prev, ''] : prev))}
              onRemove={(i) => editContents((prev) => prev.filter((_, idx) => idx !== i))}
              canPreview={recipients.length > 0}
              previewedCount={Math.min(PREVIEW_RECIPIENTS, recipients.length)}
              onPreview={() =>
                preview.mutate({
                  conversations: recipients.slice(0, PREVIEW_RECIPIENTS).map((r) => ({ accountId: r.accountId, chatKey: r.chatKey })),
                  contents
                })
              }
              preview={preview}
            />
          ) : step === 'pacing' ? (
            <PacingStep
              msgMin={msgMin}
              msgMax={msgMax}
              chatMin={chatMin}
              chatMax={chatMax}
              dryRun={dryRun}
              onMsgMin={setMsgMin}
              onMsgMax={setMsgMax}
              onChatMin={setChatMin}
              onChatMax={setChatMax}
              onDryRun={setDryRun}
            />
          ) : (
            <ConfirmStep
              name={name}
              onName={setName}
              accountCount={accountIds.length}
              recipientCount={recipients.length}
              contentCount={contents.length}
              total={total}
              overCap={overCap}
              msgRange={`${msgMin}–${msgMax} 秒`}
              chatRange={`${chatMin}–${chatMax} 秒`}
              dryRun={dryRun}
              error={create.isError ? create.error.message : null}
            />
          )}
        </div>

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button
                onClick={() => {
                  onOpen(created.taskId)
                  onClose()
                }}
              >
                进入任务
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={goBack} disabled={step === 'accounts'}>
                上一步
              </Button>
              {step === 'confirm' ? (
                <Button
                  onClick={submit}
                  disabled={
                    !name.trim() ||
                    recipients.length === 0 ||
                    !contentsValid ||
                    overCap ||
                    realFloorViolated ||
                    create.isPending
                  }
                >
                  {create.isPending ? '创建中…' : dryRun ? '创建任务（演练）' : '创建任务（真发）'}
                </Button>
              ) : (
                <Button onClick={goNext} disabled={!canNext()}>
                  下一步
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountsStep({
  accounts,
  selected,
  onToggle
}: {
  accounts: PlatformAccount[]
  selected: number[]
  onToggle: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Label>在线 WhatsApp 账号（可多选）</Label>
      {accounts.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">没有在线的 WhatsApp 账号，请先在账号侧栏扫码上线。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const active = selected.includes(a.id)
            return (
              <button
                key={a.id}
                onClick={() => onToggle(a.id)}
                className={
                  active
                    ? 'rounded-full border border-transparent bg-primary px-3 py-1 text-xs text-primary-foreground'
                    : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                {a.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RecipientsStep({
  accounts,
  q,
  onQChange,
  audienceKey,
  onAudienceChange,
  audiences,
  audienceCustomerIds,
  audienceActive,
  selectedKeys,
  onToggle,
  summary,
  overCap
}: {
  accounts: PlatformAccount[]
  q: string
  onQChange: (v: string) => void
  audienceKey: string
  onAudienceChange: (v: string) => void
  audiences: { id: number; name: string }[]
  audienceCustomerIds: Set<number>
  audienceActive: boolean
  selectedKeys: Set<string>
  onToggle: (r: Recipient) => void
  summary: string
  overCap: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder="按标题 / 会话键过滤"
        />
        <Select value={audienceKey} onValueChange={onAudienceChange}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>按人群包</SelectItem>
            {audiences.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {summary}
        {overCap && <span className="ml-2 text-destructive">超过 {MAX_TOTAL_DETAILS} 条上限</span>}
      </p>
      {accounts.map((account) => (
        <AccountConversationSection
          key={account.id}
          account={account}
          q={q}
          audienceCustomerIds={audienceCustomerIds}
          audienceActive={audienceActive}
          selectedKeys={selectedKeys}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function AccountConversationSection({
  account,
  q,
  audienceCustomerIds,
  audienceActive,
  selectedKeys,
  onToggle
}: {
  account: PlatformAccount
  q: string
  audienceCustomerIds: Set<number>
  audienceActive: boolean
  selectedKeys: Set<string>
  onToggle: (r: Recipient) => void
}): React.JSX.Element {
  const { data, isPending } = useConversations({ accountId: account.id, size: RECIPIENT_FETCH_SIZE })
  const rows = flattenConversations(data?.pages)
    .filter((c) => matchesQuery(c, q))
    .filter((c) => !audienceActive || (c.customerId !== null && audienceCustomerIds.has(c.customerId)))

  return (
    <div className="rounded-lg border border-border/60">
      <p className="border-b border-border/40 px-3 py-1.5 text-xs font-medium text-foreground">{account.name}</p>
      <div className="max-h-40 space-y-1 overflow-auto p-2">
        {isPending ? (
          <p className="py-4 text-center text-xs text-muted-foreground">加载会话中…</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {audienceActive ? '人群包在该账号下没有命中会话。' : '没有匹配的会话。'}
          </p>
        ) : (
          rows.map((c) => {
            const checked = selectedKeys.has(recipientKey(c))
            return (
              <label
                key={recipientKey(c)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(toRecipient(c))}
                  className="size-3.5 shrink-0 accent-[oklch(0.488_0.243_264.376)]"
                />
                <span className="min-w-0 flex-1 truncate">{c.title ?? c.chatKey}</span>
                <span className="max-w-[10rem] shrink-0 truncate text-[11px] text-muted-foreground">{c.chatKey}</span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}

function ContentsStep({
  contents,
  errors,
  onChange,
  onAdd,
  onRemove,
  canPreview,
  previewedCount,
  onPreview,
  preview
}: {
  contents: string[]
  errors: (string | null)[]
  onChange: (index: number, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  canPreview: boolean
  previewedCount: number
  onPreview: () => void
  preview: ReturnType<typeof useBatchPreview>
}): React.JSX.Element {
  const previewRows = preview.data?.rows ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>消息内容（最多 {MAX_CONTENTS} 条，支持 {'{客户名}'} / {'{号码}'}）</Label>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={contents.length >= MAX_CONTENTS}>
          <Plus className="size-3.5" />
          添加一条
        </Button>
      </div>
      {contents.map((c, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-2">
            <textarea
              className="h-20 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={c}
              onChange={(e) => onChange(i, e.target.value)}
              placeholder={`第 ${i + 1} 条正文`}
            />
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              title="删除"
              onClick={() => onRemove(i)}
              disabled={contents.length <= 1}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
        </div>
      ))}
      <div className="space-y-2">
        <Button size="sm" variant="outline" onClick={onPreview} disabled={!canPreview || preview.isPending}>
          {preview.isPending ? '预览中…' : '预览渲染结果'}
        </Button>
        {!canPreview && <p className="text-xs text-muted-foreground">先在收件人步勾选至少一位收件人。</p>}
        {preview.isError && <p className="text-xs text-destructive">{preview.error.message}</p>}
        {previewRows.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">
              前 {previewedCount} 位收件人的渲染结果（复用后端渲染器，未识别花括号原样保留）：
            </p>
            {previewRows.map((row) => (
              <div key={`${row.chatKey}:${row.contentIndex}`} className="rounded-md bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">
                  {row.chatKey} · 第 {row.contentIndex + 1} 条
                </p>
                <p className="whitespace-pre-wrap break-words text-xs text-foreground">{row.body}</p>
              </div>
            ))}
            {preview.data?.truncated && <p className="text-[11px] text-muted-foreground">预览条数已达上限，其余未列出。</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function PacingStep({
  msgMin,
  msgMax,
  chatMin,
  chatMax,
  dryRun,
  onMsgMin,
  onMsgMax,
  onChatMin,
  onChatMax,
  onDryRun
}: {
  msgMin: number
  msgMax: number
  chatMin: number
  chatMax: number
  dryRun: boolean
  onMsgMin: (v: number) => void
  onMsgMax: (v: number) => void
  onChatMin: (v: number) => void
  onChatMax: (v: number) => void
  onDryRun: (v: boolean) => void
}): React.JSX.Element {
  const num = (v: string): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>同人间隔 min（秒）</Label>
          <Input
            type="number"
            min={0}
            value={msgMin}
            aria-invalid={!dryRun && msgMin < REAL_MIN_MSG_INTERVAL}
            onChange={(e) => onMsgMin(num(e.target.value))}
          />
          {!dryRun && msgMin < REAL_MIN_MSG_INTERVAL && (
            <p className="text-xs text-destructive">真发不能低于 {REAL_MIN_MSG_INTERVAL} 秒</p>
          )}
        </div>
        <div className="space-y-1">
          <Label>同人间隔 max（秒）</Label>
          <Input type="number" min={0} value={msgMax} onChange={(e) => onMsgMax(num(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>换人间隔 min（秒）</Label>
          <Input
            type="number"
            min={0}
            value={chatMin}
            aria-invalid={!dryRun && chatMin < REAL_MIN_CHAT_INTERVAL}
            onChange={(e) => onChatMin(num(e.target.value))}
          />
          {!dryRun && chatMin < REAL_MIN_CHAT_INTERVAL && (
            <p className="text-xs text-destructive">真发不能低于 {REAL_MIN_CHAT_INTERVAL} 秒</p>
          )}
        </div>
        <div className="space-y-1">
          <Label>换人间隔 max（秒）</Label>
          <Input type="number" min={0} value={chatMax} onChange={(e) => onChatMax(num(e.target.value))} />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={dryRun} onCheckedChange={onDryRun} />
        演练模式（不发真实消息）
        <Badge variant={dryRun ? 'default' : 'outline'} className="text-[11px]">
          {dryRun ? '演练' : '真发'}
        </Badge>
      </label>
    </div>
  )
}

function ConfirmStep({
  name,
  onName,
  accountCount,
  recipientCount,
  contentCount,
  total,
  overCap,
  msgRange,
  chatRange,
  dryRun,
  error
}: {
  name: string
  onName: (v: string) => void
  accountCount: number
  recipientCount: number
  contentCount: number
  total: number
  overCap: boolean
  msgRange: string
  chatRange: string
  dryRun: boolean
  error: string | null
}): React.JSX.Element {
  const line = (label: string, value: React.ReactNode): React.JSX.Element => (
    <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>任务名</Label>
        <Input value={name} onChange={(e) => onName(e.target.value)} placeholder="例如：9 月回访演练" />
      </div>
      <div className="rounded-lg border border-border/60 px-3 py-1">
        {line('账号数', accountCount)}
        {line('收件人数', recipientCount)}
        {line('内容条数', contentCount)}
        {line('总条数', total)}
        {line('同人间隔', msgRange)}
        {line('换人间隔', chatRange)}
        {line('模式', dryRun ? <Badge className="text-[11px]">演练</Badge> : <Badge variant="outline" className="text-[11px]">真发</Badge>)}
      </div>
      {overCap && (
        <p className="text-xs text-destructive">
          超过 {MAX_TOTAL_DETAILS} 条上限——减几个收件人或删掉几条内容才能创建。
        </p>
      )}
      {error && <p className="text-xs text-destructive">创建失败：{error}</p>}
    </div>
  )
}

function RejectedPanel({ result }: { result: BatchCreateVO }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">
        这 {result.rejected.length} 个收件人被跳过（任务 #{result.taskId} 已创建，共 {result.totalCount} 条）
      </p>
      <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border/60 p-2">
        {result.rejected.map((r, i) => (
          <p key={`${r.accountId}:${r.chatKey}:${i}`} className="text-xs text-muted-foreground">
            {r.chatKey} — {r.reason}
          </p>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">被跳过的收件人不会出现在任务里；先核对这份清单，再进任务。</p>
    </div>
  )
}
