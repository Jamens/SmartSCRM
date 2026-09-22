// src/renderer/src/components/messages/ReplyComposer.tsx
import { useState } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  settingsInputOf,
  useTranslationSettings,
  useTrialTranslate,
  useUpdateTranslationSettings
} from '@/api/translation'
import { decideDraft, MAX_DRAFT_LEN, TOO_LONG_HINT } from '@/lib/sendDraft'
import { useBridgeOf, useSendText } from '@/lib/liveTailSync'
import { broadcastTranslationFlags } from '@/lib/translationSync'
import type { ConversationVO } from '@/api/messages'

interface Props {
  accountId: number
  conversation: ConversationVO
}

export default function ReplyComposer({ accountId, conversation }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bridge = useBridgeOf(accountId)
  // 陌生会话（customerId 为 null）拿到的就是全局：解析顺序 customer→global 在后端（Task 6）
  const { data: settings } = useTranslationSettings(conversation.customerId)
  const saveSettings = useUpdateTranslationSettings()
  const translate = useTrialTranslate()
  const { send } = useSendText(accountId, conversation.chatKey)
  const offline = !bridge || !settings

  const sendNow = async (): Promise<void> => {
    if (!settings) return
    // 重入闸：Enter 这条路不受按钮上那个 `disabled={busy}` 保护，等回执期间再敲一次就是
    // 两条一样的消息发出去两次（客户那边看得一清二楚）。键位与按钮两条路必须同一个闸。
    if (busy) return
    const decision = decideDraft(draft, settings)
    if (decision.kind === 'empty') return
    if (decision.kind === 'tooLong') {
      setHint(TOO_LONG_HINT)
      return
    }
    if (decision.kind === 'blocked') {
      setHint(decision.reason)
      return
    }
    setHint(null)
    setBusy(true)
    try {
      let text = decision.text
      if (decision.kind === 'translate') {
        const result = await translate.mutateAsync({
          text,
          type: 'send',
          customerId: conversation.customerId ?? undefined
        })
        text = result.translation
      }
      const outcome = await send(text)
      if (outcome.ok) {
        setDraft('')
        setHint(null)
      } else {
        setHint(outcome.message)
      }
    } catch (e) {
      // 这个 catch 只能是**译文通道**抛的：`send` 自己不会 reject——`lib/liveTailSync.ts` 的
      // `useSendText` 给 `msgService.send` 包的那层 try/catch（那里的文档注释是这件事的另一半）
      // 就是这条标注为真的前提。它哪天开始往外抛，这句文案就会变成假原因
      //（用户以为发不出去是翻译的锅，其实是桥），改那一处时必须同时回来改这里。
      // 留字不降级：译文拿不到就把原文留在框里。降级成"直接发中文"是最坏选择——
      // 用户以为发的是译文，实际发出去的是他刚敲的中文。
      setHint(`译文获取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleSendLang = (next: boolean): void => {
    if (!settings) return
    // 写回它读到的那一层：这份设置是某客户的覆盖行就改覆盖行，是继承来的全局就改全局。
    // 在客户会话里点一下开关就悄悄改掉全局，等于让别人的语向跟着变。
    // 绑成一个 const：下面"要不要广播"判的必须恰好是"这次写的是哪一层"，两处各判一次就会分叉。
    const overrideKey = settings.scope === 'customer' ? settings.scopeKey : null
    // catch 是必需的：`mutateAsync` 失败是 rejected promise，接不住就是一条未处理拒绝。
    // 不假装成功：Switch 的 checked 来自查询数据（受控），请求挂了它就停在原值，这里只补一句原因。
    void saveSettings
      .mutateAsync({
        ...settingsInputOf(settings, { sendEnabled: next }),
        ...(overrideKey ? { scope: 'customer', scopeKey: overrideKey } : {})
      })
      .then((saved) => {
        // P5 的不变式：**谁改了 flags 谁广播**。翻译中心每次保存后都广播（`TranslationPage.patch`
        // 里那句 `await broadcastTranslationFlags(saved)`），而 `useTranslationSync` 一个进程只推
        // 一次（`pushed.current` 那道闸），所以回复框这个第二个写入方不补一句就不只是"已经注入的
        // 页面停在旧值"：`latest` 也只由 `broadcastTranslationFlags` 赋值（translationSync.ts:25/51），
        // 本进程之后新建或重新注入的页面拿到的同样是那份旧值。
        //
        // 只广播**真正写到全局行**的那一次：payload 是进程级的一份 flags，注入层没有"按客户"的
        // 通道（那是 Task 17/17b 的射程），客户覆盖行今天对页内没有任何影响，把它推下去反而是
        // 把一份和页内无关的开关塞进所有内嵌页。
        if (overrideKey) return
        void broadcastTranslationFlags(saved).catch(() => {
          // 库里的值已经改好了，别把它报成"保存失败"：这里只交代页内那一份没跟上来。
          setHint('开关已保存，但没能同步到内嵌页')
        })
      })
      .catch((e: unknown) => {
        setHint(`开关保存失败：${e instanceof Error ? e.message : String(e)}`)
      })
  }

  return (
    <div className="border-t border-border/60 px-6 py-3">
      <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch
            checked={settings?.sendEnabled ?? false}
            disabled={!settings || saveSettings.isPending}
            onCheckedChange={toggleSendLang}
          />
          先译再发
        </label>
        <span>
          {/* 与闸门口径一致：`decideDraft` / `gateDraft` 量的都是 trim 之后的长度（发出去的也是
              那份），这里数原始长度的话框上会写着 5001 / 5000，而那条其实发得出去。 */}
          {draft.trim().length} / {MAX_DRAFT_LEN}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          data-p6-composer="reply"
          rows={2}
          value={draft}
          disabled={offline}
          placeholder={
            offline ? '会话未在线，登录后才能在这里回复' : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送、Shift+Enter 换行（spec §8）。这里不看 `enterToSend`：
            // 那个开关管的是内嵌页自己的输入框，应用内回复框是普通 textarea，语义只有一套。
            if (e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            void sendNow()
          }}
          className="min-h-[52px] max-h-40 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary/60 disabled:opacity-60"
        />
        <Button
          size="sm"
          disabled={offline || busy || !draft.trim()}
          onClick={() => void sendNow()}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          发送
        </Button>
      </div>
      {hint && <p className="pt-1.5 text-xs text-destructive">{hint}</p>}
    </div>
  )
}
