// src/renderer/src/components/messages/ReplyComposer.tsx
import { useState } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  settingsInputOf,
  useTranslationSettings,
  useTrialTranslate,
  useUpdateTranslationSettings
} from '@/api/translation'
import { decideDraft, MAX_DRAFT_LEN, TOO_LONG_HINT } from '@/lib/sendDraft'
import { directionSummary } from '@/lib/directionDraft'
import {
  conversationRefOf,
  customerRefOf,
  refOfScope,
  scopeBadgeOf,
  settingsScopeOf
} from '@/lib/scopeLabel'
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
  const [sentScope, setSentScope] = useState<string | null>(null)
  const bridge = useBridgeOf(accountId)
  // 会话档优先（spec §3.2 / §4②）：这里的 `settings` 是"这一条会话的生效行"，
  // 它同时决定「先译再发」的初值、`decideDraft` 的中文拦截、以及旁边那枚摘要与徽标。
  // 连带效果要写清（spec §9 的边界之外）：会话行里的 `disableChinese` 等开关**会**影响回复框，
  // 因为回复框读的就是生效行；本阶段不给它们控件，值只随 §3.3 的整份复制携带。
  // 记录页那颗「语向」仍只编辑客户档（D-07），所以它显示的档位可能与这里不同——徽标就是为此而存在。
  // `chatKey` 这里不再过一次 128 裁剪：`conversation.chatKey` 出自 `chat_conversation.chat_key`
  //（`VARCHAR(128) COLLATE utf8mb4_bin`，V8 建表），能出现在这一列里的值本来就装得下；
  // `activeChatKeyOf`（src/shared/chatKeys.ts）管的是**页内投影**那条自由字符串，两处的输入不同，
  // 这里不是漏了一道闸。
  const convRef = conversationRefOf(accountId, conversation.chatKey)
  const custRef = conversation.customerId !== null ? customerRefOf(conversation.customerId) : null
  const { data: settings } = useTranslationSettings(convRef)
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
          // §4②：不补这两个字段就是"会话档已生效、回复框却按客户档预览"的反例。
          // `customerId` 不再带：后端按 `accountId + chatKey` 自己现算客户档（§3.2），
          // 而这里手里的 `conversation.customerId` 是会话列表缓存的投影，可能与库里差一拍——
          // 少一个来源，读侧（`useTranslationSettings(convRef)`）与译侧就不可能各拿一份。
          accountId,
          chatKey: conversation.chatKey
        })
        text = result.translation
        // §4③ 的第二个来源：这次**实际**用了哪一档。它可能与上面那枚徽标不同——弹层改档位与
        // 后端解析之间隔着一次缓存失效，所以两处都要，不是重复标注。
        setSentScope(result.scope)
      } else {
        setSentScope(null)
      }
      const outcome = await send(text)
      if (outcome.ok) {
        setDraft('')
        setHint(null)
      } else {
        setHint(outcome.message)
      }
    } catch (e) {
      // 这个 catch 里**译文通道**只是头号嫌疑，不是唯一嫌疑：`lib/liveTailSync.ts` 的
      // `useSendText` 只把 `msgService.send` 那层 IPC 调用包进 try/catch（那里的文档注释是这件
      // 事的另一半），所以主进程 reject 在那边就按失败结清了、不会从这里漏出来。可 `send` 整体
      // 仍然可能在 try 之外抛（`crypto.randomUUID()`、`appendPending`、`settleLocalId`、
      // `outcomeOf` 之前的字段读取——那份注释里是同一份清单，以它为准）。那些抛照样落到这里，
      // 照样被下面那句报成"译文获取失败"这个假原因（用户以为发不出去是翻译的锅，其实出问题的
      // 是本地那几步）；排查时读 e.message 那半句。两处注释互指，改任何一处都要回来改另一处。
      // 留字不降级：译文拿不到就把原文留在框里。降级成"直接发中文"是最坏选择——
      // 用户以为发的是译文，实际发出去的是他刚敲的中文。
      setHint(`译文获取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleSendLang = (next: boolean): void => {
    if (!settings) return
    // 写回它读到的那一层（P-05，既有那条"别悄悄改掉全局"的规则扩到三档）。
    // 旧写法是 `settings.scope === 'customer' ? settings.scopeKey : null`，把 `scopeKey` 当客户 id 用；
    // 会话档上线后那一格是 `5:8613…@c.us`，照旧写下去就是把成形键塞进 `scopeKey`：
    // 控制器的数字校验回 40000，或者更糟——分派写歪，改掉别人的行。所以层由 `refOfScope` 从
    // "手里能定位的那几档"里挑，任何一格都不从 `scopeKey` 反解。
    const target = refOfScope(settings.scope, { conversation: convRef, customer: custRef })
    if (!target) {
      setHint('这一档的定位不在手里，未写入任何一行')
      return
    }
    // catch 是必需的：`mutateAsync` 失败是 rejected promise，接不住就是一条未处理拒绝。
    // 不假装成功：Switch 的 checked 来自查询数据（受控），请求挂了它就停在原值，这里只补一句原因。
    void saveSettings
      .mutateAsync({
        ...settingsInputOf(settings, { sendEnabled: next }),
        ...settingsScopeOf(target)
      })
      .then((saved) => {
        // P5 的不变式：谁改了 flags 谁广播。**只有真正写到全局行那一次**才广播——payload 是进程级
        // 的一份 flags（来源全局行，§4①b），客户档/会话档那一份对页内没有任何影响，推下去反而
        // 把一份和页内无关的开关塞进所有内嵌页。
        if (target.kind !== 'global') return
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
      <div
        className="flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground"
        data-p7-composer-bar=""
      >
        <label className="flex items-center gap-2">
          <Switch
            checked={settings?.sendEnabled ?? false}
            disabled={!settings || saveSettings.isPending}
            onCheckedChange={toggleSendLang}
          />
          先译再发
        </label>
        {/* §4③：这一枚是"这一条会话实际按哪档生效"，与会话头那枚"这位客户一般怎么说"并列是有意的（D-07）。 */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate tabular-nums" data-p7-send-summary="">
            {settings ? directionSummary(settings, 'send') : '…'}
          </span>
          <Badge
            variant="outline"
            className={
              settings && settings.scope !== 'global'
                ? 'shrink-0 border-0 bg-primary/10 text-primary'
                : 'shrink-0 border-border text-muted-foreground'
            }
            data-p7-scope-badge=""
            data-p7-scope={settings?.scope ?? ''}
          >
            {settings ? scopeBadgeOf(settings.scope) : '…'}
          </Badge>
        </span>
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
      {hint && (
        <p className="pt-1.5 text-xs text-destructive" data-p7-composer-hint="">
          {hint}
        </p>
      )}
      {sentScope && (
        <p className="pt-1.5 text-[11px] text-muted-foreground" data-p7-sent-scope={sentScope}>
          这一条按{scopeBadgeOf(sentScope)}译出
        </p>
      )}
    </div>
  )
}
