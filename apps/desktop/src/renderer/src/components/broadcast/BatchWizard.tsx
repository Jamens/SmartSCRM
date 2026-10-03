import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  accounts: 'broadcast.wizard.step.accounts',
  recipients: 'broadcast.wizard.step.recipients',
  contents: 'broadcast.wizard.step.contents',
  pacing: 'broadcast.wizard.step.pacing',
  confirm: 'broadcast.wizard.step.confirm'
}

// 这五个数与后端 `BatchRules` 是同一份规则的两处写法（MAX_BODY=5000 / isSendable），
// 这里不许自造第三个数；文案同一条口径。
const MAX_CONTENTS = 20
const MAX_BODY = 5000
const MAX_TOTAL_DETAILS = 20000
// MAX_RECIPIENTS 是 `BatchRules.java:15` 的镜像。前端不拦的代价：用户挑到 1200 人、走完五步、
// 按创建才在后端那一跳（`BatchRules.java:36-37`，「收件人超过上限 1000 人」）被拒一次——确认页一路都说「可以创建」。
// 这一档单独判，不并进 overCap：超限减的是收件人，overCap 减的是内容条数，两者文案与修法不同。
const MAX_RECIPIENTS = 1000
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
  const { t } = useTranslation()
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
    if (c.trim() === '') return t('broadcast.wizard.contentEmpty', { n: i + 1 })
    if (c.length > MAX_BODY) return t('broadcast.wizard.contentTooLong', { n: i + 1, max: MAX_BODY })
    return null
  })
  const contentsValid = contents.length > 0 && contentErrors.every((e) => e === null)
  const total = recipients.length * contents.length
  const overCap = total > MAX_TOTAL_DETAILS
  // 收件人这一档与 overCap 分开：overCap 靠减内容条数解决，这一档靠减收件人解决，文案不同、修法不同。
  const overRecipientCap = recipients.length > MAX_RECIPIENTS
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
        return recipients.length > 0 && !overCap && !overRecipientCap
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
          <DialogTitle>{t('broadcast.wizard.title')}</DialogTitle>
          <DialogDescription>
            {t('broadcast.wizard.desc', { steps: STEPS.map((s) => t(STEP_LABEL[s])).join(' → ') })}
          </DialogDescription>
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
              {t(STEP_LABEL[s])}
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
              summary={t('broadcast.wizard.summary', { recipients: recipients.length, contents: contents.length, total })}
              overCap={overCap}
              overRecipientCap={overRecipientCap}
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
              overRecipientCap={overRecipientCap}
              msgRange={t('broadcast.wizard.pacingRange', { min: msgMin, max: msgMax })}
              chatRange={t('broadcast.wizard.pacingRange', { min: chatMin, max: chatMax })}
              dryRun={dryRun}
              error={create.isError ? create.error.message : null}
            />
          )}
        </div>

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
              <Button
                onClick={() => {
                  onOpen(created.taskId)
                  onClose()
                }}
              >
                {t('broadcast.wizard.enterTask')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={goBack} disabled={step === 'accounts'}>
                {t('broadcast.wizard.prevStep')}
              </Button>
              {step === 'confirm' ? (
                <Button
                  onClick={submit}
                  disabled={
                    !name.trim() ||
                    recipients.length === 0 ||
                    !contentsValid ||
                    overCap ||
                    overRecipientCap ||
                    realFloorViolated ||
                    create.isPending
                  }
                >
                  {create.isPending
                    ? t('broadcast.wizard.creating')
                    : dryRun
                      ? t('broadcast.wizard.createDryRun')
                      : t('broadcast.wizard.createReal')}
                </Button>
              ) : (
                <Button onClick={goNext} disabled={!canNext()}>
                  {t('broadcast.wizard.nextStep')}
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
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <Label>{t('broadcast.wizard.accountsLabel')}</Label>
      {accounts.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('broadcast.wizard.noOnlineAccounts')}</p>
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
  overCap,
  overRecipientCap
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
  overRecipientCap: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder={t('broadcast.wizard.recipientSearchPlaceholder')}
        />
        <Select value={audienceKey} onValueChange={onAudienceChange}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('broadcast.wizard.byAudience')}</SelectItem>
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
        {overCap && <span className="ml-2 text-destructive">{t('broadcast.wizard.overCap', { max: MAX_TOTAL_DETAILS })}</span>}
        {overRecipientCap && (
          <span className="ml-2 text-destructive">{t('broadcast.wizard.overRecipientCap', { max: MAX_RECIPIENTS })}</span>
        )}
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
  const { t } = useTranslation()
  const { data, isPending, hasNextPage, isFetchingNextPage, isFetchNextPageError, error, fetchNextPage } =
    useConversations({ accountId: account.id, size: RECIPIENT_FETCH_SIZE })
  // 未加载的会话在向导里根本不存在：matchesQuery 与人群包过滤只作用于已加载的这些行。
  const allLoaded = flattenConversations(data?.pages)
  const loadedCount = allLoaded.length
  const rows = allLoaded
    .filter((c) => matchesQuery(c, q))
    .filter((c) => !audienceActive || (c.customerId !== null && audienceCustomerIds.has(c.customerId)))

  return (
    <div className="rounded-lg border border-border/60">
      <p className="border-b border-border/40 px-3 py-1.5 text-xs font-medium text-foreground">
        {account.name}
        {hasNextPage && (
          <span className="ml-2 font-normal text-muted-foreground">{t('broadcast.wizard.onlyFirst', { count: loadedCount })}</span>
        )}
      </p>
      <div className="max-h-40 space-y-1 overflow-auto p-2">
        {isPending ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{t('broadcast.wizard.loadingConversations')}</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {loadedCount === 0
              ? t('broadcast.wizard.noConversations')
              : audienceActive
                ? t('broadcast.wizard.audienceNoHit', {
                    count: loadedCount,
                    more: t(hasNextPage ? 'broadcast.wizard.loadMoreHint' : 'broadcast.wizard.allLoadedHint')
                  })
                : t('broadcast.wizard.noMatch', {
                    count: loadedCount,
                    more: t(hasNextPage ? 'broadcast.wizard.loadMoreHint' : 'broadcast.wizard.allLoadedHint')
                  })}
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
      {isFetchNextPageError && (
        <p className="border-t border-border/40 px-3 py-1.5 text-xs text-destructive">
          {t('broadcast.wizard.loadMoreError', { message: error?.message ?? t('common.unknownError') })}
        </p>
      )}
      {/*
        按用户点击翻页是这一版的取舍：一次把 1000 条拉完会让本地后端几百跳 + 渲染几百个 label，
        把向导首屏拖住。代价是用户要点几下才能看到第 201 条之后的会话。
        到 MAX_RECIPIENTS（M3 那一档）就不再给加载更多——加载再多也建不了单。
      */}
      {hasNextPage && loadedCount < MAX_RECIPIENTS && (
        <div className="border-t border-border/40 px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage
              ? t('broadcast.wizard.loadingMore')
              : t('broadcast.wizard.loadMore', { loaded: loadedCount, max: MAX_RECIPIENTS })}
          </Button>
        </div>
      )}
      {hasNextPage && loadedCount >= MAX_RECIPIENTS && (
        <p className="border-t border-border/40 px-3 py-1.5 text-xs text-muted-foreground">
          {t('broadcast.wizard.maxReached', { max: MAX_RECIPIENTS })}
        </p>
      )}
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
  const { t } = useTranslation()
  const previewRows = preview.data?.rows ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('broadcast.wizard.contentLabel', { max: MAX_CONTENTS })}</Label>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={contents.length >= MAX_CONTENTS}>
          <Plus className="size-3.5" />
          {t('broadcast.wizard.addContent')}
        </Button>
      </div>
      {contents.map((c, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-2">
            <textarea
              className="h-20 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={c}
              onChange={(e) => onChange(i, e.target.value)}
              placeholder={t('broadcast.wizard.contentPlaceholder', { n: i + 1 })}
            />
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              title={t('broadcast.wizard.deleteContent')}
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
          {preview.isPending ? t('broadcast.wizard.previewing') : t('broadcast.wizard.preview')}
        </Button>
        {!canPreview && <p className="text-xs text-muted-foreground">{t('broadcast.wizard.needRecipients')}</p>}
        {preview.isError && <p className="text-xs text-destructive">{preview.error.message}</p>}
        {previewRows.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/60 p-2">
            <p className="text-xs text-muted-foreground">
              {t('broadcast.wizard.previewNote', { count: previewedCount })}
            </p>
            {previewRows.map((row) => (
              <div key={`${row.chatKey}:${row.contentIndex}`} className="rounded-md bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">
                  {t('broadcast.wizard.previewRow', { chatKey: row.chatKey, n: row.contentIndex + 1 })}
                </p>
                <p className="whitespace-pre-wrap break-words text-xs text-foreground">{row.body}</p>
              </div>
            ))}
            {preview.data?.truncated && (
              <p className="text-[11px] text-muted-foreground">{t('broadcast.wizard.previewTruncated')}</p>
            )}
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
  const { t } = useTranslation()
  const num = (v: string): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t('broadcast.wizard.msgMin')}</Label>
          <Input
            type="number"
            min={0}
            value={msgMin}
            aria-invalid={!dryRun && msgMin < REAL_MIN_MSG_INTERVAL}
            onChange={(e) => onMsgMin(num(e.target.value))}
          />
          {!dryRun && msgMin < REAL_MIN_MSG_INTERVAL && (
            <p className="text-xs text-destructive">{t('broadcast.wizard.realFloorMsg', { n: REAL_MIN_MSG_INTERVAL })}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label>{t('broadcast.wizard.msgMax')}</Label>
          <Input type="number" min={0} value={msgMax} onChange={(e) => onMsgMax(num(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>{t('broadcast.wizard.chatMin')}</Label>
          <Input
            type="number"
            min={0}
            value={chatMin}
            aria-invalid={!dryRun && chatMin < REAL_MIN_CHAT_INTERVAL}
            onChange={(e) => onChatMin(num(e.target.value))}
          />
          {!dryRun && chatMin < REAL_MIN_CHAT_INTERVAL && (
            <p className="text-xs text-destructive">{t('broadcast.wizard.realFloorMsg', { n: REAL_MIN_CHAT_INTERVAL })}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label>{t('broadcast.wizard.chatMax')}</Label>
          <Input type="number" min={0} value={chatMax} onChange={(e) => onChatMax(num(e.target.value))} />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={dryRun} onCheckedChange={onDryRun} />
        {t('broadcast.wizard.dryRunLabel')}
        <Badge variant={dryRun ? 'default' : 'outline'} className="text-[11px]">
          {dryRun ? t('broadcast.mode.dryRun') : t('broadcast.mode.realSend')}
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
  overRecipientCap,
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
  overRecipientCap: boolean
  msgRange: string
  chatRange: string
  dryRun: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const line = (label: string, value: React.ReactNode): React.JSX.Element => (
    <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t('broadcast.wizard.confirmName')}</Label>
        <Input value={name} onChange={(e) => onName(e.target.value)} placeholder={t('broadcast.wizard.namePlaceholder')} />
      </div>
      <div className="rounded-lg border border-border/60 px-3 py-1">
        {line(t('broadcast.wizard.lAccount'), accountCount)}
        {line(t('broadcast.wizard.lRecipient'), recipientCount)}
        {line(t('broadcast.wizard.lContent'), contentCount)}
        {line(t('broadcast.wizard.lTotal'), total)}
        {line(t('broadcast.wizard.lMsgInterval'), msgRange)}
        {line(t('broadcast.wizard.lChatInterval'), chatRange)}
        {line(
          t('broadcast.wizard.lMode'),
          dryRun ? <Badge className="text-[11px]">{t('broadcast.mode.dryRun')}</Badge> : <Badge variant="outline" className="text-[11px]">{t('broadcast.mode.realSend')}</Badge>
        )}
      </div>
      {overCap && (
        <p className="text-xs text-destructive">{t('broadcast.wizard.overCapCreate', { max: MAX_TOTAL_DETAILS })}</p>
      )}
      {overRecipientCap && (
        <p className="text-xs text-destructive">{t('broadcast.wizard.overRecipientCreate', { max: MAX_RECIPIENTS })}</p>
      )}
      {error && <p className="text-xs text-destructive">{t('broadcast.wizard.createError', { message: error })}</p>}
    </div>
  )
}

function RejectedPanel({ result }: { result: BatchCreateVO }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">
        {t('broadcast.wizard.rejectedTitle', {
          count: result.rejected.length,
          taskId: result.taskId,
          total: result.totalCount
        })}
      </p>
      <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border/60 p-2">
        {result.rejected.map((r, i) => (
          <p key={`${r.accountId}:${r.chatKey}:${i}`} className="text-xs text-muted-foreground">
            {t('broadcast.wizard.rejectedItem', { chatKey: r.chatKey, reason: r.reason })}
          </p>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('broadcast.wizard.rejectedNote')}</p>
    </div>
  )
}
