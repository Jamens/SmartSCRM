// src/renderer/src/components/messages/TakeoverBar.tsx
import { useState } from 'react'
import { Bot, Hand, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useResumeAi, useTakeover, useTransferHuman, type ConversationVO } from '@/api/messages'
import { handlingOf, statusLabelKey, statusToneClass } from '@/lib/handlingStatus'

interface Props {
  conversation: ConversationVO
}

/**
 * B28 接管条：当前会话的处理态 + 三个动作（接管 / 交还 AI / 手动转人工）。
 *
 * **按钮集合由状态唯一决定**，不多不少：
 * - AI：只给「转人工」——会话正由 AI 应答，坐席想亲自接手就先转。
 * - WAITING_TAKEOVER：给「接管」与「交还 AI」——在队列里，接管或退回给 AI。
 * - HUMAN_ACTIVE：给「交还 AI」与「转人工」——已在服务中，但可以退回 AI 或再入队。
 *
 * 三个动作都调后端状态机，前端不自行推演下一态：推演一份就会出现"界面说已接管、
 * 后端其实没改"（网络失败时），而接管是有先到先得语义的（他人已接管 → 40900），
 * 界面必须让用户看见这个拒绝。
 */
export default function TakeoverBar({ conversation }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const status = handlingOf(conversation)
  const takeover = useTakeover()
  const resumeAi = useResumeAi()
  const transferHuman = useTransferHuman()
  const [error, setError] = useState<string | null>(null)

  const busy = takeover.isPending || resumeAi.isPending || transferHuman.isPending
  const tone = statusToneClass(status)

  /**
   * 失败时把后端 message 显示出来——「该会话已被其他坐席接管」正是需要让人看到的一句
   * （接管是先到先得语义，界面必须让用户看见这个拒绝）。三个动作共用这一个出口：
   * 各写各的 onError 就会漏掉一处，而漏掉的那一处正是"点了没反应也没提示"。
   * 每次点击先清上一次的残留，否则一次成功后那句红字会一直挂着。
   */
  const fail = (e: Error): void => setError(e.message)
  const act = (fn: () => void): void => {
    setError(null)
    fn()
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1" data-p6-takeover="">
      <div className="flex items-center gap-1.5">
        {tone !== null && (
          <Badge
            variant="outline"
            className={`h-6 border-0 px-2 text-[11px] ${tone}`}
            data-p6-takeover-status={status}
          >
            {t(statusLabelKey(status))}
          </Badge>
        )}
        {status === 'AI' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            data-p6-action="transfer-human"
            onClick={() => act(() => transferHuman.mutate(conversation.id, { onError: fail }))}
          >
            <Hand className="size-3.5" />
            {t('messages.takeover.transferHuman')}
          </Button>
        )}
        {status === 'WAITING_TAKEOVER' && (
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            data-p6-action="takeover"
            onClick={() => act(() => takeover.mutate(conversation.id, { onError: fail }))}
          >
            <UserCheck className="size-3.5" />
            {t('messages.takeover.takeover')}
          </Button>
        )}
        {status !== 'AI' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            data-p6-action="resume-ai"
            onClick={() => act(() => resumeAi.mutate(conversation.id, { onError: fail }))}
          >
            <Bot className="size-3.5" />
            {t('messages.takeover.resumeAi')}
          </Button>
        )}
        {status === 'HUMAN_ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            data-p6-action="transfer-human"
            onClick={() => act(() => transferHuman.mutate(conversation.id, { onError: fail }))}
          >
            <Hand className="size-3.5" />
            {t('messages.takeover.requeue')}
          </Button>
        )}
      </div>

      {conversation.transferReason !== null && conversation.transferReason !== '' && (
        <span
          className="max-w-[220px] truncate text-[11px] text-muted-foreground"
          title={conversation.transferReason}
        >
          {t('messages.takeover.reason', { reason: conversation.transferReason })}
        </span>
      )}
      {error !== null && (
        <span className="max-w-[220px] truncate text-[11px] text-destructive" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
