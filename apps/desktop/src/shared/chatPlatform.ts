// src/shared/chatPlatform.ts
/**
 * `chat_*` 表里 `platform` 列的取值，与 `platform_account.platform_type` 的映射。
 * Java 侧的同名映射在 `service/msg/ChatKeys.platformOfAccountType`：两处必须同时改。
 */
export type ChatPlatform = 'whatsapp' | 'telegram'

export const WHATSAPP_ACCOUNT_TYPE = 1
export const TELEGRAM_ACCOUNT_TYPE = 4
// WA 协议号：与 WhatsApp 同形态（chat_key 都是 @c.us/@g.us），但走外部 protocol 服务、
// 不经网页登录、不建 WebContentsView（B27）。复用 'whatsapp' 这个 storage/platform 值即可被
// 现有入库面接受，不需要新展示面（B27 入站腿）。出站腿是第二套发送实现，另立阶段。
export const WHATSAPP_PROTOCOL_ACCOUNT_TYPE = 7
// TG 协议源（MTProto）：与 4 = Telegram 网页版区分——4 走 WebContentsView + 注入翻译层，
// 8 走外部协议网关、不建视图。期一只有常量与映射，无账号创建流程（spec Q2）。
export const TELEGRAM_PROTOCOL_ACCOUNT_TYPE = 8

const BY_CODE = new Map<number, ChatPlatform>([
  [WHATSAPP_ACCOUNT_TYPE, 'whatsapp'],
  [TELEGRAM_ACCOUNT_TYPE, 'telegram'],
  // 协议号(7) 与 WA 同形态、走外部 protocol 服务，复用 'whatsapp' 入库面（B27 入站腿）。
  [WHATSAPP_PROTOCOL_ACCOUNT_TYPE, 'whatsapp'],
  // TG 协议源(8) 的 chat_key 是 TG 数字形态（正整数 / -100 前缀），'telegram' 入库面已认（R3）。
  [TELEGRAM_PROTOCOL_ACCOUNT_TYPE, 'telegram']
])

export function isChatPlatform(value: unknown): value is ChatPlatform {
  return value === 'whatsapp' || value === 'telegram'
}

export function platformOfAccountType(type: number | null | undefined): ChatPlatform | null {
  return typeof type === 'number' ? (BY_CODE.get(type) ?? null) : null
}

export function accountTypeOfPlatform(platform: ChatPlatform): 1 | 4 {
  return platform === 'whatsapp' ? WHATSAPP_ACCOUNT_TYPE : TELEGRAM_ACCOUNT_TYPE
}
