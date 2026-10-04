// src/renderer/src/lib/handlingStatus.ts
import type { ConversationVO, HandlingStatus } from '@/api/messages'

/**
 * B28 处理态的唯一读法。V16 给 `handling_status` 的 DB 默认值是 'AI'，但那列可空，
 * 老行与手工插入的行会读出 `null`——界面上 `null` 与 `'AI'` 是同一件事（没有转人工
 * 就是 AI 应答中），所以归一在这里做一次，而不是让每个读它的地方各写一遍 `?? 'AI'`
 * 然后其中一处漏掉（漏掉的后果是徽标不显示、按钮组不出现）。
 */
export function handlingOf(conversation: Pick<ConversationVO, 'handlingStatus'>): HandlingStatus {
  return conversation.handlingStatus ?? 'AI'
}

/** 是否在接管队列里（等坐席接）。徽标与队列入口都只问这一句。 */
export function isWaiting(conversation: Pick<ConversationVO, 'handlingStatus'>): boolean {
  return handlingOf(conversation) === 'WAITING_TAKEOVER'
}

/** 是否已被某个坐席接管。这是"规则不再抢它"的界面侧对应事实。 */
export function isHumanActive(conversation: Pick<ConversationVO, 'handlingStatus'>): boolean {
  return handlingOf(conversation) === 'HUMAN_ACTIVE'
}

/**
 * i18n 键：`messages.takeover.status.<态>`。集中一处是因为三处徽标各写一个字面量时，
 * 漏翻译的那一处会退化成显示原始英文枚举（`WAITING_TAKEOVER`），而不是少一个色块。
 */
export function statusLabelKey(status: HandlingStatus): string {
  return `messages.takeover.status.${status}`
}

/**
 * 徽标配色（Tailwind 类，不是 Badge 的 variant）：Badge 只有 default/secondary/
 * destructive/outline/ghost 六个 variant，没有"警告/进行中"这类语义色，硬套
 * destructive 会把"等人工"说成"出错了"。所以这里直接给类名，AI 态返回 `null`
 * 表示"这一格留空"——默认态挂徽标等于整列同色，是噪声而不是信息。
 */
export function statusToneClass(status: HandlingStatus): string | null {
  if (status === 'WAITING_TAKEOVER') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  if (status === 'HUMAN_ACTIVE') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  return null
}
