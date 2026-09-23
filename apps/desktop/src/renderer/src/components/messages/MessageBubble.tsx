// src/renderer/src/components/messages/MessageBubble.tsx
import type { ReactNode } from 'react'
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
  const out = row.direction === 'out'
  // 先收到局部变量再判：TS 对 `row.mediaType` 这种属性路径的收窄不如局部 const 稳。
  const mediaType = row.mediaType
  const Media = mediaType === 'text' ? null : MEDIA_ICON[mediaType]
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
          {row.senderName ?? row.senderKey ?? '群成员'}
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
            {row.mediaSummary ?? '媒体消息'}
          </span>
        )}
        {row.body ? (
          <span className="whitespace-pre-wrap break-words">{row.body}</span>
        ) : (
          // 三种"看起来该有字却没有字"的情况要分得开：纯媒体（上面那行已经交代）、
          // 真空消息（这里补一句，否则气泡会塌成一条线，读者以为是渲染坏了）
          !Media && <span className="opacity-60">（空消息）</span>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {timeOfMessage(row.ts)}
        {out && <Tick status={row.status} />}
        {out &&
          row.status === 'failed' &&
          (failedHint ?? <Badge variant="outline">发送失败</Badge>)}
        {out && row.source === 'native_send' && <span>· 页面内发送</span>}
      </span>
    </div>
  )
}
