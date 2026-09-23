// src/renderer/src/components/messages/CreateCustomerDialog.tsx
import { useEffect, useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/http'
import { useCreateCustomer } from '@/api/customers'
import { useLinkCustomer, type ConversationVO } from '@/api/messages'
import { prefillOfConversation } from '@/lib/createCustomerPrefill'

type Phase = 'form' | 'linking' | 'link-failed'

interface Props {
  conversation: ConversationVO
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 两步都成功才回调：只创建成功不算闭环完成（会话头还挂着「陌生」）。 */
  onLinked: (customerId: number) => void
}

export default function CreateCustomerDialog({
  conversation,
  open,
  onOpenChange,
  onLinked
}: Props): React.JSX.Element {
  const prefill = useMemo(() => prefillOfConversation(conversation), [conversation])
  const create = useCreateCustomer()
  const link = useLinkCustomer()
  const [nickname, setNickname] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [createdId, setCreatedId] = useState<number | null>(null)

  // 只在"打开的那一瞬间"按会话快照铺一次：`prefill` 不进依赖，理由与 `CustomerDirectionDialog`
  // 里那句是同一件事——列表 refetch（新消息到达、窗口重新聚焦）会换掉 `conversation` 的对象身份，
  // 带着它铺表单就会把用户敲了一半的昵称抹回预填值。
  useEffect(() => {
    if (!open) {
      // 与 `CustomerDirectionDialog` 同一件事：`create.isError` 跨开关残留的话，
      // 下一次打开弹层第一眼是上一轮的「已经有客户了」。
      create.reset()
      link.reset()
      return
    }
    if (!prefill) return
    // 每次打开都重铺：上一轮失败留下的输入会让用户以为"我已经改过了"。
    setNickname(prefill.nickname ?? '')
    setPhone(prefill.phone ?? '')
    setRemark('')
    setPhase('form')
    setCreatedId(null)
  }, [open])

  const doLink = (customerId: number): void => {
    setPhase('linking')
    link.mutate(
      { conversationId: conversation.id, customerId },
      {
        onSuccess: (r) => {
          // messagesLinked 可以是 0（这个会话的历史消息此前已被自动匹配写过归属）。
          // 那仍是成功：会话头已经挂上，回填范围由后端的"只补空"口径决定。
          onLinked(r.customerId)
        },
        onError: () => setPhase('link-failed')
      }
    )
  }

  const submit = (): void => {
    if (!prefill) return
    create.mutate(
      {
        platformType: prefill.platformType,
        openId: prefill.openId,
        nickname: nickname.trim() || null,
        phone: phone.trim() || null,
        remark: remark.trim() || null
      },
      {
        onSuccess: (customer) => {
          // 先记下 id：第二步失败时「重试关联」要点的就是这一位，重新走一遍第一步只会撞 40901。
          setCreatedId(customer.id)
          doLink(customer.id)
        }
      }
    )
  }

  const duplicate = create.error instanceof ApiError && create.error.code === 40901

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            建为客户
          </DialogTitle>
          <DialogDescription>
            创建这位会话对端的客户，并把该会话已入库的历史消息回填给他。
          </DialogDescription>
        </DialogHeader>

        {!prefill && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            这个会话不能建客户（群会话或已关联客户）。
          </p>
        )}

        {prefill && phase !== 'link-failed' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">会话 ID（open_id）</Label>
              <Input value={prefill.openId} readOnly className="bg-muted text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                就是这条会话的 chat_key，改它等于给另一个号码建客户。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">昵称</Label>
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="留空则不填"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">手机号</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="留空则不填"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">备注</Label>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="可选"
              />
            </div>
            {create.isError && (
              <p
                data-p6-create-error=""
                data-p6-error-code={create.error instanceof ApiError ? String(create.error.code) : ''}
                className="text-xs text-destructive"
              >
                {create.error instanceof Error ? create.error.message : '创建失败'}
                {duplicate &&
                  ' —— 该平台下这个 open_id 已经有客户了。当前没有"按 open_id 找已有客户"的入口（客户列表的关键词只搜昵称 / 手机 / 邮箱），请到客户管理页确认是哪一位。'}
              </p>
            )}
          </div>
        )}

        {phase === 'link-failed' && createdId !== null && (
          <div className="flex flex-col gap-2" data-p6-link-failed="">
            <p className="text-xs text-destructive">
              客户 #{createdId} 已经创建成功，但历史消息关联失败（会话头还没挂上）。
            </p>
            {/*
             * 第二步的失败原因也要露，而且露的是**码**：这一段原来是固定文案，于是 40404（会话行不在了）、
             * 40000（后端不让群会话挂客户）与 50000（后端自己炸了）在界面上长得一模一样，而三者对应的
             * 下一步完全不同——前两条点「重试关联」不会好，只有最后一条值得再点。与上面 `create.isError`
             * 同一口径：属性给人判，中文给人读。
             */}
            {link.isError && (
              <p
                data-p6-link-error=""
                data-p6-error-code={link.error instanceof ApiError ? String(link.error.code) : ''}
                className="text-xs text-destructive"
              >
                {link.error instanceof Error ? link.error.message : '关联失败'}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              重试只会补"关联"这一步，不会再建一位重复客户——重复的 open_id 会被后端挡在 40901。
            </p>
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {phase === 'link-failed' ? '先关掉' : '取消'}
          </Button>
          {phase === 'link-failed' && createdId !== null ? (
            <Button
              size="sm"
              data-p6-action="link-retry"
              disabled={link.isPending}
              onClick={() => doLink(createdId)}
            >
              {link.isPending ? '关联中…' : '重试关联'}
            </Button>
          ) : (
            <Button
              size="sm"
              data-p6-action="create-submit"
              disabled={!prefill || create.isPending || phase === 'linking'}
              onClick={submit}
            >
              {phase === 'linking' ? '关联中…' : create.isPending ? '创建中…' : '建为客户并关联历史'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
