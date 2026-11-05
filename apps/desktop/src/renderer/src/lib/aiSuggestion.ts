// src/renderer/src/lib/aiSuggestion.ts
/**
 * B28 接管台建议的纯判定（无 React / 无 I/O，可单测）。
 *
 * 与后端 `PersonaEngine` 的语义对齐：前端禁用只是第一道闸（S4），后端仍会校验
 * `ai_persona_id` 并拒绝；来源徽标让坐席一眼看出手上这条是不是知识库里的标准答案（S1）。
 */

/** 后端 `chat_conversation.ai_suggestion_source` 的取值；null = 无建议或 V54 之前的旧数据。 */
export type SuggestionSource = 'retrieval' | 'model' | null

/** `canGenerate` 只需要队列项里的这一个字段，避免测试造一堆无关数据。 */
export interface GeneratableItem {
  aiPersonaId: number | null
}

/**
 * 未绑人设 = 无模型路径（S4），按钮禁用；生成中也不放行，防连点打爆本地端点。
 * 这是纯前端判定，**不能替代后端校验**——后端 `PersonaEngine.generate` 会再次拒绝。
 */
export function canGenerate(item: GeneratableItem, generating: boolean): boolean {
  return item.aiPersonaId != null && !generating
}

/**
 * 来源 → i18n key。`retrieval` 是知识库标准答案、`model` 是模型按人设生成，
 * 两者可靠性不同，坐席必须能区分（S1）。未知值 / null 一律不显示徽标——
 * 老数据的 source 为 null，误标成"模型生成"比不标更危险。
 */
export function sourceBadge(source: SuggestionSource | undefined | string): string | null {
  if (source === 'retrieval') return 'ai.queue.sourceKnowledge'
  if (source === 'model') return 'ai.queue.sourceModel'
  return null
}
