// src/renderer/src/components/messages/MessageBubble.tsx
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Film,
  Image,
  MapPin,
  Music,
  Sticker,
  User,
  type LucideIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { timeOfMessage } from '@/lib/chatDisplay'
import type { ThreadRow } from '@/api/messages'
import { useImageTranslate, useVoiceTranslate } from '@/api/translation'
import type { MediaType, MsgStatus } from '@shared/chatTypes'

/**
 * 媒体只存"类型 + 摘要"（spec §3 的隐私口径），所以这里永远是占位，不是缩略图：
 * 采集链不下载、不落盘，`mediaSummary` 是页内能拿到的描述性文字（文件名、时长、地点名）。
 */
const MEDIA_ICON: Record<Exclude<MediaType, 'text'>, LucideIcon> = {
  image: Image,
  audio: Music,
  video: Film,
  document: FileText,
  sticker: Sticker,
  contact: User,
  location: MapPin,
  unknown: FileText
}

/** out 的投递阶梯：⏱ 待发送、✓ 已送平台、✓✓ 已送达、✓✓(主色) 已读、⚠ 失败。`received` 只属于 in，落到 default 返回 null。 */
function Tick({ status }: { status: MsgStatus }): React.JSX.Element | null {
  switch (status) {
    case 'pending':
      return <Clock3 className="size-3" />
    case 'failed':
      return <AlertTriangle className="size-3 text-destructive" />
    case 'sent':
      return <Check className="size-3" />
    case 'delivered':
      return <CheckCheck className="size-3" />
    case 'read':
      return <CheckCheck className="size-3 text-primary" />
    default:
      return null
  }
}

interface Props {
  row: ThreadRow
  /** 群聊才显示发送人：单聊里这一行永远是"对方"或"自己"，占了宽度不给信息。 */
  showSender: boolean
  /** Task 15 的「重试」按钮从这里进来；本任务用默认的失败文案。 */
  failedHint?: ReactNode
  /** 搜索跳转命中时的 2 秒描边：只加在外层行容器上，`data-msg-key` 与它同一处，CDP 取的就是这个节点。 */
  highlight?: boolean
}

export default function MessageBubble({
  row,
  showSender,
  failedHint,
  highlight
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const out = row.direction === 'out'
  // 先收到局部变量再判：TS 对 `row.mediaType` 这种属性路径的收窄不如局部 const 稳。
  const mediaType = row.mediaType
  const Media = mediaType === 'text' ? null : MEDIA_ICON[mediaType]
  // B25：图片/语音气泡提供「翻译」入口；媒体字节不在前端，由用户从本机选文件递交后端 OCR/ASR。
  const isMediaTranslateable = mediaType === 'image' || mediaType === 'audio'
  const [showMedia, setShowMedia] = useState(false)
  return (
    <div
      /**
       * 值是平台原生 id 本身（`id._`），不带 chatKey：同一条会话内唯一，跨会话不保证。
       * Task 16 的锚点跳转要按它定位时，选择器必须限定在当前线程容器里
       * （`[data-p6-scroller="thread"] [data-msg-key="..."]`），否则可能命中另一个会话缓存页里的同键节点。
       */
      data-msg-key={row.msgKey}
      className={cn(
        'mb-2 flex flex-col rounded-lg transition-colors',
        out ? 'items-end' : 'items-start',
        highlight && 'bg-primary/10 ring-1 ring-primary/50'
      )}
    >
      {showSender && !out && (
        <span className="mb-0.5 text-[11px] text-muted-foreground">
          {row.senderName ?? row.senderKey ?? t('messages.bubble.groupMember')}
        </span>
      )}
      <div
        className={cn(
          'max-w-[560px] rounded-2xl px-3 py-2 text-sm leading-relaxed',
          out
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground'
        )}
      >
        {Media && (
          <span className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
            <Media className="size-3.5" />
            {row.mediaSummary ?? t('messages.bubble.media')}
          </span>
        )}
        {row.body ? (
          <span className="whitespace-pre-wrap break-words">{row.body}</span>
        ) : (
          // 三种"看起来该有字却没有字"的情况要分得开：纯媒体（上面那行已经交代）、
          // 真空消息（这里补一句，否则气泡会塌成一条线，读者以为是渲染坏了）
          !Media && <span className="opacity-60">{t('messages.bubble.empty')}</span>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {/* A8 入站敏感词：后端入库时判定并存标记，这里只显示。放元信息行是它恒渲染，
            分组气泡（不显示发送者）也能看到标记。 */}
        {!out && row.hasSensitive && (
          <Badge variant="outline" data-p8g-sensitive="" className="border-destructive/50 text-destructive">
            {t('messages.bubble.sensitive')}
          </Badge>
        )}
        {timeOfMessage(row.ts)}
        {isMediaTranslateable && (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => setShowMedia((v) => !v)}
          >
            {t('translation.media.translate')}
          </button>
        )}
        {out && <Tick status={row.status} />}
        {out &&
          row.status === 'failed' &&
          (failedHint ?? <Badge variant="outline">{t('messages.bubble.sendFailed')}</Badge>)}
        {out && row.source === 'native_send' && <span>· 页面内发送</span>}
      </span>
      {showMedia && isMediaTranslateable && (
        <MediaTranslatePanel
          row={row}
          kind={mediaType === 'image' ? 'image' : 'audio'}
        />
      )}
    </div>
  )
}

/**
 * B25 会话内媒体翻译面板：媒体字节不在前端（MessageBubble 隐私口径），所以由用户从本机选文件，
 * 以 base64 递交后端 OCR/ASR + 翻译。type 按气泡方向取 send/receive，并带上 accountId/chatKey/
 * customerId 让后端按会话生效语向译出。
 */
function MediaTranslatePanel({
  row,
  kind
}: {
  row: ThreadRow
  kind: 'image' | 'audio'
}): React.JSX.Element {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [b64, setB64] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageMut = useImageTranslate()
  const voiceMut = useVoiceTranslate()

  function onPick(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null)
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      const comma = url.indexOf(',')
      setB64(comma >= 0 ? url.slice(comma + 1) : url)
    }
    reader.readAsDataURL(f)
  }

  function run(): void {
    if (!b64) return
    const mut = kind === 'image' ? imageMut : voiceMut
    mut.mutate({
      data: b64,
      mime: file?.type ?? '',
      type: row.direction === 'out' ? 'send' : 'receive',
      accountId: row.accountId,
      chatKey: row.chatKey,
      customerId: row.customerId
    })
  }

  const result = imageMut.data ?? voiceMut.data
  const pending = imageMut.isPending || voiceMut.isPending

  return (
    <div className="mt-1 flex max-w-[560px] flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-xs">
      <p className="text-[11px] text-muted-foreground">{t('translation.media.inConversationHint')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-background"
          onClick={() => fileRef.current?.click()}
        >
          {kind === 'image' ? t('translation.media.pickImage') : t('translation.media.pickAudio')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={kind === 'image' ? 'image/*' : 'audio/*'}
          className="hidden"
          onChange={onPick}
        />
        <button
          type="button"
          disabled={!b64 || pending}
          onClick={run}
          className="rounded-full bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
        >
          {t('translation.media.translate')}
        </button>
      </div>
      {file && <p className="truncate text-[11px] text-muted-foreground">{file.name}</p>}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {result && (
        <div className="flex flex-col gap-1">
          <p>
            <span className="text-muted-foreground">{t('translation.media.extracted')}：</span>
            {result.extractedText}
          </p>
          <p className="text-foreground">
            <span className="text-muted-foreground">{t('translation.media.result')}：</span>
            {result.translation}
          </p>
          <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            {result.degraded && <span className="text-amber-600">{t('translation.media.degradedMock')}</span>}
            <span>
              {result.fromLangCode || 'auto'} → {result.toLangCode}
            </span>
          </p>
        </div>
      )}
      {(imageMut.isError || voiceMut.isError) && (
        <p className="text-[11px] text-red-600">{t('translation.requestFailed')}</p>
      )}
    </div>
  )
}
