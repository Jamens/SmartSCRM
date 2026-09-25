// src/renderer/src/lib/scopeLabel.ts
/**
 * 翻译设置「档」在渲染层的唯一解释处：一档位怎么寻址（`SettingsRef`）、怎么变成缓存键与请求参数、
 * 读回来的那一档叫什么、写回去该写到哪一档。
 * 这里**不 import 任何模块**：`tsconfig.unit.json` 没有 `@/` 别名，import 进来就进不了 `node --test`；
 * 也**不拼、不解析会话档的 `scope_key`**——那条串只有一个作者（后端 `ConversationScopeKey`，spec §3.4）。
 * 反向依赖同样禁止：`api/translation.ts` 可以 import 这里，这里谁都不 import。
 */

export interface GlobalSettingsRef {
  kind: 'global'
}
export interface CustomerSettingsRef {
  kind: 'customer'
  customerId: number
}
/** 两个字段而不是一个键串：这样渲染层拼不出也解析不出 `<accountId>:<chatKey>`。 */
export interface ConversationSettingsRef {
  kind: 'conversation'
  accountId: number
  chatKey: string
}
export type SettingsRef = GlobalSettingsRef | CustomerSettingsRef | ConversationSettingsRef

export const GLOBAL_REF: SettingsRef = { kind: 'global' }

export const customerRefOf = (customerId: number): CustomerSettingsRef => ({
  kind: 'customer',
  customerId
})

export const conversationRefOf = (accountId: number, chatKey: string): ConversationSettingsRef => ({
  kind: 'conversation',
  accountId,
  chatKey
})

/**
 * 一档一条缓存（spec §6「取数与缓存要加第三个维度」）。会话那条按 `accountId + chatKey` 分两段：
 * 拼成串再切回去就是"渲染层在解析会话键"；而且 `chatKey` 里本来就有 `@` 与 `.`,拼串只是把
 * 一个数组能表达的东西换成一条需要转义的字面量。**键段不含 `customerId`**（P-01）：会话档读到的
 * 那一行由它决定不了，客户档由后端按同一条 chat 现算（spec §3.2）。
 */
export const settingsKeyOf = (
  ref: SettingsRef
): readonly (
  'translation-settings' | 'global' | 'customer' | 'conversation' | number | string
)[] => {
  if (ref.kind === 'customer') return ['translation-settings', 'customer', ref.customerId] as const
  if (ref.kind === 'conversation')
    return ['translation-settings', 'conversation', ref.accountId, ref.chatKey] as const
  return ['translation-settings', 'global'] as const
}

/** GET 的查询串（不含 `?`）。与 `settingsKeyOf` 同源，所以"同一把键 ⇒ 同一个请求"是构造出来的。 */
export const settingsParamsOf = (ref: SettingsRef): string => {
  if (ref.kind === 'customer') return `customerId=${ref.customerId}`
  if (ref.kind === 'conversation')
    return `accountId=${ref.accountId}&chatKey=${encodeURIComponent(ref.chatKey)}`
  return ''
}

/** PUT body 里定位档位的那几格（`settingsInputOf` 的结果之上再叠一层）。 */
export interface SettingsScopeFields {
  scope: 'global' | 'customer' | 'conversation'
  scopeKey?: string
  accountId?: number
  chatKey?: string
}

export const settingsScopeOf = (ref: SettingsRef): SettingsScopeFields => {
  if (ref.kind === 'customer') return { scope: 'customer', scopeKey: String(ref.customerId) }
  if (ref.kind === 'conversation')
    return { scope: 'conversation', accountId: ref.accountId, chatKey: ref.chatKey }
  return { scope: 'global' }
}

/** 三态徽标文案（spec §3.1 那张表）。`inherited` 不在这里参与判断：§3.2 里 `scope` 已经唯一决定档位。 */
export const scopeBadgeOf = (scope: string): string => {
  if (scope === 'conversation') return '本会话专属'
  if (scope === 'customer') return '该客户专属'
  if (scope === 'global') return '沿用全局'
  // 不猜：这枚徽标是在替后端说"这一条按哪档生效"，猜错就是屏幕上摆一句假话（spec §4③）。
  return '生效档未识别'
}

/** 调用方手里**能定位**的那几档（翻译中心一档都不给，它只改全局）。 */
export interface WriteTargets {
  conversation?: ConversationSettingsRef | null
  customer?: CustomerSettingsRef | null
}

/**
 * 「写回它读到的那一档」——`ReplyComposer.toggleSendLang` 那条既有规则扩到三档（P-05）。
 * 关键在**不回退**：定位不到那一档就回 `null`，调用方必须不写。退回全局是最坏选择——
 * 在某个会话里点一下开关就把全局行改了，别人的语向跟着变（那正是这条规则当初要挡的事）。
 * 也不从 `vo.scopeKey` 反解任何一档的身份：会话档那一格是 `<accountId>:<chatKey>`（spec §3.1
 * 明写"只显示、不解析"），而客户档那一格 `Number()` 出来的数字调用方本来就有（`conversation.customerId`）。
 */
export const refOfScope = (scope: string, targets: WriteTargets): SettingsRef | null => {
  if (scope === 'global') return GLOBAL_REF
  if (scope === 'conversation') return targets.conversation ?? null
  if (scope === 'customer') return targets.customer ?? null
  return null
}
