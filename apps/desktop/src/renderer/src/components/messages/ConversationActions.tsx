// src/renderer/src/components/messages/ConversationActions.tsx
import { useState } from 'react'
import { Languages, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import CustomerDirectionDialog from '@/components/messages/CustomerDirectionDialog'
import CreateCustomerDialog from '@/components/messages/CreateCustomerDialog'
import { useCustomer } from '@/api/customers'
import { useTranslationSettings } from '@/api/translation'
import { customerRefOf } from '@/lib/scopeLabel'
import type { ConversationVO } from '@/api/messages'
import { directionSummary } from '@/lib/directionDraft'
import { canCreateCustomer } from '@/lib/createCustomerPrefill'

/**
 * 已关联会话的身份 + 语向入口。单独成组件是为了让两个按 customerId 取数的 hook
 * 只在"真的有一位客户"时挂载：`useTranslationSettings` 的新签名只收具体档位
 * （`customerRefOf(customerId)`），未关联的会话根本没有 customer id 可包——拿别的档
 * 去显示"这位客户的语向"就是假信息，所以这个组件还是按 `customerId` 挂载。
 */
function LinkedIdentity({ customerId }: { customerId: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { data: settings } = useTranslationSettings(customerRefOf(customerId))
  const { data: customer } = useCustomer(customerId)
  return (
    <>
      <Badge
        variant="outline"
        className="h-6 max-w-[160px] truncate border-0 bg-primary/10 px-2 text-[11px] text-primary"
        data-p6-customer-name=""
      >
        {customer?.nickname ?? `客户 #${customerId}`}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 px-2 text-[11px]"
        data-p6-action="direction"
        onClick={() => setOpen(true)}
      >
        <Languages className="size-3.5" />
        语向
      </Button>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" data-p6-direction-summary="">
        {settings ? directionSummary(settings, 'send') : '…'}
      </span>
      <CustomerDirectionDialog customerId={customerId} open={open} onOpenChange={setOpen} />
    </>
  )
}

interface Props {
  conversation: ConversationVO
  onLinked: (customerId: number) => void
}

export default function ConversationActions({
  conversation,
  onLinked
}: Props): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const creatable = canCreateCustomer(conversation)
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-p6-actions="header">
      {conversation.customerId !== null && <LinkedIdentity customerId={conversation.customerId} />}
      {creatable && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            data-p6-action="create"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus className="size-3.5" />
            建为客户
          </Button>
          <CreateCustomerDialog
            conversation={conversation}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onLinked={(id) => {
              setCreateOpen(false)
              onLinked(id)
            }}
          />
        </>
      )}
    </div>
  )
}
