// src/renderer/src/lib/sendDraft.ts
/**
 * 与主进程 `msgApi.isSendable` 同一个上限：主进程是最后一道，这里只是别让人对着
 * 一条注定发不出去的消息敲字。两处数字改动必须一起改（注释互认，跨进程没法共享常量）。
 */
export const MAX_DRAFT_LEN = 5_000

export interface DraftFlags {
  sendEnabled: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
}

export type DraftDecision =
  | { kind: 'empty' }
  | { kind: 'tooLong' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'translate'; text: string }
  | { kind: 'plain'; text: string }

/**
 * CJK 统一表意文字。注入层的同名判定在 `inject/core/translation/inputPreview.ts`：
 * 那是另一个 bundle、引不到这里（P5 定的 bundle 边界），所以规则写两遍、注释互认。
 * 文案也要一致——「消息含中文，已拦截发送」在页内预览和这里必须是同一句。
 */
const CJK = /[\u4e00-\u9fa5]/

/** 回复框的全部判断：先判空与超长，再判拦截，最后才决定要不要走译文通道。 */
export function decideDraft(raw: string, flags: DraftFlags): DraftDecision {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  if (text.length > MAX_DRAFT_LEN) return { kind: 'tooLong' }
  // 顺序是契约：拦在译前面。反过来就变成"把中文交给厂商接口，再把译文发出去"，
  // 用户要的"别把中文发出去"没实现，还多打了一次外呼（C1）。
  if (flags.disableChinese && flags.disableChinesePreventSend && CJK.test(text)) {
    return { kind: 'blocked', reason: '消息含中文，已拦截发送' }
  }
  return flags.sendEnabled ? { kind: 'translate', text } : { kind: 'plain', text }
}
