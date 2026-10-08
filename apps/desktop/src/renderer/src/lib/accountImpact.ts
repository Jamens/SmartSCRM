// src/renderer/src/lib/accountImpact.ts
import type { AccountImpact } from '@/stores/accounts'

/**
 * 删除平台账号会被 `ON DELETE CASCADE` 带走的五张表：`chat_conversation` / `chat_message`
 * （V8）与 `chat_group` / `group_member_state` / `group_member_event`（V12）。
 *
 * 名单写在这一处，界面上那一列就只由它决定。它同时也是**模式漂移的雷线**：日后给
 * `platform_account` 再加一条 CASCADE，改这条数组与后端 VO 才会让那一格出现；漏一处
 * 的后果是弹层少报一类被永久删掉的数据，而少报比不报更危险——用户看到的就是全部。
 */
export const IMPACT_ROW_KEYS = [
  'conversations',
  'messages',
  'groups',
  'memberStates',
  'memberEvents'
] as const satisfies readonly (keyof AccountImpact)[]

export interface ImpactRow {
  key: (typeof IMPACT_ROW_KEYS)[number]
  count: number
}

/**
 * 计数 → 界面那一列。`null`（还没统计到 / 统计失败）返回**空列表**而不是五个 0——
 * 「没统计到」与「这张表确实没有行」是两件事，后者才该说 0。
 * 计数为 0 的行留在列表里：0 本身就是「这类数据不会被带走」这句有用的话。
 */
export function impactRowsOf(impact: AccountImpact | null): ImpactRow[] {
  if (!impact) return []
  return IMPACT_ROW_KEYS.map((key) => ({ key, count: impact[key] }))
}

/** 五张表全为 0 才成立，界面上换一句「不会连带任何记录」，避免空表格看起来像加载坏了。 */
export function hasArchivedRows(impact: AccountImpact): boolean {
  return IMPACT_ROW_KEYS.some((key) => impact[key] > 0)
}
