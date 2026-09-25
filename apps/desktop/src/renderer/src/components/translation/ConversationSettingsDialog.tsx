// src/renderer/src/components/translation/ConversationSettingsDialog.tsx
import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ChannelRow, LangRow } from '@/components/translation/DirectionLangRows'
import {
  settingsInputOf,
  useResetConversationTranslationSettings,
  useTranslationSettings,
  useUpdateTranslationSettings
} from '@/api/translation'
import { conversationRefOf, scopeBadgeOf, settingsScopeOf } from '@/lib/scopeLabel'
import { ApiError } from '@/lib/http'
import { draftOf, dirtyCount, type DirectionDraft } from '@/lib/directionDraft'

interface Props {
  accountId: number
  chatKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 会话档编辑器。入口只有一个（工作台舞台那颗「会话设置」），记录页的「语向」仍只编辑客户档（D-07）：
 * 两处开同一个弹层会让用户分不清自己在改哪一层。
 * 这里**没有任何 enabled 开关**（spec §6 / D-09）：会话档改的是"怎么说"（语种、线路），
 * 不是"要不要说"——页内开关位仍是进程级一份 flags、来源全局行。给了控件就是给一颗按了没反应的按钮，
 * 所以那几列只随 §3.3 的整份复制从生效行带过去，界面上既不说谎也不逐个解释列的去处。
 */
export default function ConversationSettingsDialog({
  accountId,
  chatKey,
  open,
  onOpenChange
}: Props): React.JSX.Element {
  // 档位定位那一格由 `conversationRefOf` 一处成形（与读侧、缓存键、URL 参数同一作者），不在这里手写第二份。
  const ref = conversationRefOf(accountId, chatKey)
  const { data } = useTranslationSettings(ref)
  const save = useUpdateTranslationSettings()
  const reset = useResetConversationTranslationSettings()
  const [draft, setDraft] = useState<DirectionDraft | null>(null)

  // 与 `CustomerDirectionDialog` 同一套铺法：只在打开那一瞬间抓一次初值。
  // 按 `data` 无条件重铺的话，保存后的整前缀失效会触发一次 refetch，把用户改到一半的表单抹回库里值。
  // `save` / `reset` 不进依赖：`useMutation` 每次渲染回的都是新对象，而 `mutationObserver.reset()`
  // 无条件 notify 一次，把它们写进依赖就是"关闭态下每帧重跑本效应"的无限重渲染。
  // 本组件的 `accountId` / `chatKey` 由调用方在点开那一刻定死（`AccountStage` 的 `settingsTarget`），
  // 存续期内不会换会话，所以初值只需要铺一次；关闭即整棵卸载，下一次点开是新实例。
  useEffect(() => {
    if (!open) {
      setDraft(null)
      // 本舞台的调用方是"关闭即卸载"，走不到这一支；留着是给以后改成常驻复用（像客户档那个弹层，
      // Radix 关闭只卸载 `DialogContent`、组件本体常驻）的调用方兜底：不清错误态的话，重开弹层
      // 第一眼看过去的"保存失败"是上一轮的残留，那是假话。
      save.reset()
      reset.reset()
      return
    }
    if (data) setDraft((d) => d ?? draftOf(data))
  }, [open, data])

  const patch = (p: Partial<DirectionDraft>): void => setDraft((d) => (d ? { ...d, ...p } : d))
  const dirty = data && draft ? dirtyCount(data, draft) : 0
  // 徽标答的是"这一份值来自哪一档"，不是"这一档有没有行"：`data.scope` 是后端按 §3.2 解析出的生效档，
  // 所以第一次打开时它多半写着「沿用全局」——那正是下面那句提示要交代的东西。
  const badge = data ? scopeBadgeOf(data.scope) : '…'
  const ownRow = data?.scope === 'conversation'
  // 那句"谁不动"按后端答的 `scope` 判，不拿徽标文案去比：文案是给人读的，改一个字就会让
  // "该客户的设置不动"悄悄变成"全局设置不动"。`scope` 认不出来时如实说未识别，不替它猜一档。
  const inheritHint =
    data?.scope === 'customer'
      ? '该客户的设置不动'
      : data?.scope === 'global'
        ? '全局设置不动'
        : '生效档未识别，保存只写这一档'

  const submit = (): void => {
    if (!data || !draft) return
    save.mutate(settingsInputOf(data, { ...draft, ...settingsScopeOf(ref) }), {
      onSuccess: () => onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-p7-conv-dialog="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-primary" />
            当前会话的语向
          </DialogTitle>
          <DialogDescription>
            只作用于这一条会话，优先级高于该客户的语向与全局设置。
            {/* 标题在 `chat_conversation.title`，为舞台一颗按钮去拉会话列表不划算（spec §6）：
                这里显示 `chatKey` 原文，`8613…@c.us` 这个形态本身可读。 */}
            <span
              className="mt-1 block truncate font-mono text-[11px] text-muted-foreground"
              data-p7-conv-chatkey=""
            >
              {chatKey}
            </span>
            未关联客户时这是这条会话的唯一标识。只改语种与线路：开关位（先译再发 / 接收翻译 /
            输入框预览 / 中文拦截）本阶段仍是全局那一份。
          </DialogDescription>
        </DialogHeader>

        {!data && <p className="py-6 text-center text-xs text-muted-foreground">读取设置中…</p>}
        {data && draft && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  ownRow
                    ? 'border-0 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
                }
                data-p7-conv-badge=""
                data-p7-scope={data.scope}
              >
                {badge}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {ownRow
                  ? '这一档已有覆盖行，保存会整份覆盖它。'
                  : `保存后只为这条会话建一份覆盖，${inheritHint}。`}
              </span>
            </div>

            <LangRow
              title="收信"
              from={draft.receiveFromLang}
              to={draft.receiveToLang}
              onFrom={(v) => patch({ receiveFromLang: v })}
              onTo={(v) => patch({ receiveToLang: v })}
              channel={draft.channel}
            />
            <LangRow
              title="发信"
              from={draft.sendFromLang}
              to={draft.sendToLang}
              onFrom={(v) => patch({ sendFromLang: v })}
              onTo={(v) => patch({ sendToLang: v })}
              channel={draft.channel}
            />
            <ChannelRow value={draft.channel} onChange={(v) => patch({ channel: v })} />

            {/* 改线路会把两侧的可选语种整组换掉，而表单里可能留着一份上一线路不支持的组合。
                这里不预先回退（那等于悄悄改掉用户没碰过的那几列）：交下去由后端判，
                它回 40000 + 点名句式的文案，下面这一行如实显示码值（C12）。 */}
            {save.isError && (
              <p
                data-p7-conv-error=""
                data-p7-error-code={save.error instanceof ApiError ? String(save.error.code) : ''}
                className="text-xs text-destructive"
              >
                保存失败：{save.error instanceof Error ? save.error.message : '后端不可用'}
              </p>
            )}
            {/* 两个失败出口两条标记（与客户档那个弹层同一口径）：塞进同一个属性，读的人就分不出
                "没存上"和"没删掉"。 */}
            {reset.isError && (
              <p
                data-p7-conv-reset-error=""
                data-p7-error-code={reset.error instanceof ApiError ? String(reset.error.code) : ''}
                className="text-xs text-destructive"
              >
                恢复失败：{reset.error instanceof Error ? reset.error.message : '后端不可用'}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            data-p7-conv-reset=""
            // 「恢复继承」只在**本档有行**时才是"删掉它"：没有行时删是空操作（`cleared:0` 也回 200），
            // 按钮亮着而点了什么都不发生，那就是假按钮。客户档那个弹层同一条规矩。
            disabled={!data || !ownRow || reset.isPending}
            onClick={() => reset.mutate(ref, { onSuccess: () => onOpenChange(false) })}
          >
            {reset.isPending ? '恢复中…' : '恢复继承'}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              // 驱动要能"不保存就关掉"这颗弹层。`button:last-child` 那种位置选择器在这里会点到「保存」
              // （它在同一个 `<div>` 里排在取消之后），而保存是 disabled 的——点了什么都不发生，
              // 于是"关闭失败"看起来像"弹层卡住了"。给它一颗自己的标记。
              data-p7-conv-cancel=""
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              data-p7-conv-save=""
              disabled={dirty === 0 || save.isPending || !draft}
              onClick={submit}
            >
              {save.isPending ? '保存中…' : dirty > 0 ? `保存（${dirty} 处改动）` : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
