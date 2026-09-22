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

/** 「超过上限」那一句在两个地方说给人听（回复框与失败气泡的重试），句式只留一份。 */
export const TOO_LONG_HINT = `超过 ${MAX_DRAFT_LEN} 字，请分条发送`

/** 发送闸的结论：能不能发，与"要不要先翻一遍"无关。 */
export type DraftGate = { kind: 'ok' } | { kind: 'tooLong' } | { kind: 'blocked'; reason: string }

/**
 * CJK 统一表意文字。注入层的同名判定在 `inject/core/translation/inputPreview.ts`：
 * 那是另一个 bundle、引不到这里（P5 定的 bundle 边界），所以规则写两遍、注释互认。
 * 文案也要一致——「消息含中文，已拦截发送」在页内预览和这里必须是同一句。
 */
const CJK = /[\u4e00-\u9fa5]/

/**
 * 发送闸：只回答「这条正文现在能不能发出去」——长度与中文拦截两件事。
 *
 * 单独导出是因为**重试**也必须过它：`MessageBubble` 的失败插槽对任何 `out` + `failed` 的行都
 * 会出现，其中包含 `source:'native_send'`（在页面里发的、本应用从没判过正文的那一类）。那些正文
 * 从没走过 `decideDraft`，少了这道闸就是"中文拦截开着时点一下重试，中文原样出去，既不提示也
 * 没说理由"。长度也在这里判：主进程 `msgApi.isSendable` 确实是最后一道，但它只回一条 SEND_FAILED，
 * 说不出"为什么发不出去"。
 *
 * 闸门**不看 `sendEnabled`**：那是"要不要先翻一遍"，不是"能不能发"——重试按契约不重译，
 * 它要的正是这半边的判定。判空也不在这里，由调用方各自处置：回复框有 `empty` 这条出口，
 * 重试那侧把全空白的正文当成"没有可重发的内容"停下（`MessageThread.retryFrom`）。
 */
export function gateDraft(raw: string, flags: DraftFlags): DraftGate {
  const text = raw.trim()
  if (text.length > MAX_DRAFT_LEN) return { kind: 'tooLong' }
  if (flags.disableChinese && flags.disableChinesePreventSend && CJK.test(text)) {
    return { kind: 'blocked', reason: '消息含中文，已拦截发送' }
  }
  return { kind: 'ok' }
}

/** 回复框的全部判断：先判空，再过发送闸，最后才决定要不要走译文通道。 */
export function decideDraft(raw: string, flags: DraftFlags): DraftDecision {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  // 顺序是契约：拦在译前面（闸门的实现与重试共用一个 `gateDraft`，不会出现一处改了另一处忘）。
  // 反过来就变成"把中文交给厂商接口，再把译文发出去"，
  // 用户要的"别把中文发出去"没实现，还多打了一次外呼（C1）。
  const gate = gateDraft(text, flags)
  if (gate.kind !== 'ok') return gate
  return flags.sendEnabled ? { kind: 'translate', text } : { kind: 'plain', text }
}
