import {
  AtSign,
  Globe,
  MessageCircle,
  MessagesSquare,
  Radio,
  Send,
  Sparkles,
  type LucideIcon
} from 'lucide-react'

/** Platform ids; the numeric values match the server's `platform_type` column. */
export enum PlatformType {
  WhatsApp = 1,
  Line = 2,
  AIStar = 3,
  Telegram = 4,
  Facebook = 5,
  Messenger = 6,
  WhatsAppProtocol = 7
}

export interface PlatformMeta {
  type: PlatformType
  label: string
  short: string
  /** Channel key understood by the injected bundle's `__SCRM_INJECT__`. */
  channel: string
  /** Public web client opened inside the embedded view; null when the channel has no web login. */
  embedUrl: string | null
  hint: string
  color: string
  icon: LucideIcon
}

export const PLATFORMS: Record<PlatformType, PlatformMeta> = {
  [PlatformType.WhatsApp]: {
    type: PlatformType.WhatsApp,
    label: 'WhatsApp',
    short: 'WA',
    channel: 'WhatsApp',
    embedUrl: 'https://web.whatsapp.com',
    hint: '扫码登录 WhatsApp Web',
    color: '#25D366',
    icon: MessageCircle
  },
  [PlatformType.Line]: {
    type: PlatformType.Line,
    label: 'LINE',
    short: 'LINE',
    channel: 'Line',
    embedUrl: null,
    hint: 'LINE 无公开网页端，暂未开放内嵌',
    color: '#06C755',
    icon: AtSign
  },
  [PlatformType.AIStar]: {
    type: PlatformType.AIStar,
    label: 'AIStar',
    short: 'AI',
    channel: 'AIStar',
    embedUrl: null,
    hint: '内部智能助手通道',
    color: '#7C3AED',
    icon: Sparkles
  },
  [PlatformType.Telegram]: {
    type: PlatformType.Telegram,
    label: 'Telegram',
    short: 'TG',
    channel: 'Telegram',
    // 路径必须钉到 /k/：根地址会被页面自己的路由带到 /a/（2026-09-22 实测 location.href
    // 停在 /a/），而 P6 的整套 TG 契约是按 K 版那一套 DOM 定的（P6 spec §11）。
    embedUrl: 'https://web.telegram.org/k/',
    hint: '手机 Telegram 扫码登录 Telegram Web（设置 > 设备 > 登录网页版）',
    color: '#229ED9',
    icon: Send
  },
  [PlatformType.Facebook]: {
    type: PlatformType.Facebook,
    label: 'Facebook',
    short: 'FB',
    channel: 'Facebook',
    embedUrl: 'https://www.facebook.com',
    hint: '登录 Facebook 账号',
    color: '#1877F2',
    icon: Globe
  },
  [PlatformType.Messenger]: {
    type: PlatformType.Messenger,
    label: 'Messenger',
    short: 'MSG',
    channel: 'Messenger',
    embedUrl: 'https://www.messenger.com',
    hint: '登录 Messenger',
    color: '#0084FF',
    icon: MessagesSquare
  },
  [PlatformType.WhatsAppProtocol]: {
    type: PlatformType.WhatsAppProtocol,
    label: 'WA 协议号',
    short: 'WAP',
    channel: 'WhatsAppProtocol',
    embedUrl: null,
    hint: '协议托管账号，无需网页登录',
    color: '#128C7E',
    icon: Radio
  }
}

export const EMBEDDABLE_PLATFORMS: PlatformType[] = Object.values(PLATFORMS)
  .filter((p) => p.embedUrl !== null)
  .map((p) => p.type)

export function platformOf(type: number): PlatformMeta | null {
  return PLATFORMS[type as PlatformType] ?? null
}
