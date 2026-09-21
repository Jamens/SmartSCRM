// src/shared/chatPlatform.ts
/**
 * `chat_*` 表里 `platform` 列的取值，与 `platform_account.platform_type` 的映射。
 * Java 侧的同名映射在 `service/msg/ChatKeys.platformOfAccountType`：两处必须同时改。
 */
export type ChatPlatform = 'whatsapp' | 'telegram'

export const WHATSAPP_ACCOUNT_TYPE = 1
export const TELEGRAM_ACCOUNT_TYPE = 4

const BY_CODE = new Map<number, ChatPlatform>([
  [WHATSAPP_ACCOUNT_TYPE, 'whatsapp'],
  [TELEGRAM_ACCOUNT_TYPE, 'telegram']
])

export function isChatPlatform(value: unknown): value is ChatPlatform {
  return value === 'whatsapp' || value === 'telegram'
}

export function platformOfAccountType(type: number | null | undefined): ChatPlatform | null {
  return typeof type === 'number' ? BY_CODE.get(type) ?? null : null
}

export function accountTypeOfPlatform(platform: ChatPlatform): 1 | 4 {
  return platform === 'whatsapp' ? WHATSAPP_ACCOUNT_TYPE : TELEGRAM_ACCOUNT_TYPE
}
