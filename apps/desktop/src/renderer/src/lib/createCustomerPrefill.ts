// src/renderer/src/lib/createCustomerPrefill.ts
// 相对路径 + `.ts` 后缀是闸门要求的（与 `chatSearch.ts` / `chatDays.ts` 同一个写法）：本文件被
// `node --test` 直接跑，Node 不认 `@shared/*` 别名——那一边只在 tsconfig 的 paths 里存在。
import { accountTypeOfPlatform, type ChatPlatform } from '../../../shared/chatPlatform.ts'
import { isGroupChatKey, peerPhoneOfChatKey } from '../../../shared/chatKeys.ts'

/**
 * 与 Task 5 的 `CustomerCreateRequest` 里"预填得出的那四个字段"同形。
 * 闸门里的文件不许 import `@/api/customers`（那会把 react-query 拖进 node --test），
 * 所以这里按形状写一遍；提交时 `CreateCustomerInput` 的其余字段全部可空，展开即可。
 */
export interface Prefill {
  platformType: number
  openId: string
  nickname: string | null
  phone: string | null
}

/** 只用到 `ConversationVO` 的这五个字段，测试里能手搓一条会话。 */
export interface PrefillSource {
  chatKey: string
  title: string | null
  platform: ChatPlatform
  isGroup: boolean
  customerId: number | null
}

/**
 * 群判定看两处：会话头的 `isGroup` 与 `chatKey` 的形态，两处都要过。
 * 前者是采集时归一化写进去的结论，后者是键本身。只信一处时，一条 head 标错的群会话
 * 会被建成一位客户，而 link-customer 紧接着把整个群的历史消息回填到这位不存在的客户身上。
 */
export function canCreateCustomer(c: PrefillSource): boolean {
  return c.customerId === null && !c.isGroup && !isGroupChatKey(c.chatKey)
}

/** 不能建就返回 null：调用方拿一个 `null` 去禁用按钮，比自己再判一遍三个条件好。 */
export function prefillOfConversation(c: PrefillSource): Prefill | null {
  if (!canCreateCustomer(c)) return null
  const nickname = c.title?.trim() ?? ''
  return {
    platformType: accountTypeOfPlatform(c.platform),
    openId: c.chatKey,
    nickname: nickname || null,
    phone: peerPhoneOfChatKey(c.chatKey)
  }
}
