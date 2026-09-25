// src/renderer/src/lib/directionDraft.ts
/** 语向弹层能改的全部字段：收 / 发各一条「启用 + 源 + 目标」，外加整档共用的线路。 */
export interface DirectionDraft {
  /**
   * 线路是**一整档一个值**：它同时决定收发两侧的可选语种，所以塞进 `LangRow` 会变成
   * 两格各带一份线路。会话档弹层有控件（Task 9），客户档弹层没有——那里 `draft.channel`
   * 恒等于打开时读到的那一份，提交时带回去是同一个值（P-07 的"行为逐字段不变"，由 Task 10 CDP 第 6 行兜）。
   */
  channel: string
  receiveEnabled: boolean
  receiveFromLang: string
  receiveToLang: string
  sendEnabled: boolean
  sendFromLang: string
  sendToLang: string
}

/** 弹层读得到的字段子集；`TranslationSettingVO` 结构上就满足它。 */
export type DirectionSource = DirectionDraft

/** 显式逐字段挑，不用 rest 剔除：以后 VO 多一个字段时必须在这里表态一次。 */
export function draftOf(s: DirectionSource): DirectionDraft {
  return {
    channel: s.channel,
    receiveEnabled: s.receiveEnabled,
    receiveFromLang: s.receiveFromLang,
    receiveToLang: s.receiveToLang,
    sendEnabled: s.sendEnabled,
    sendFromLang: s.sendFromLang,
    sendToLang: s.sendToLang
  }
}

/**
 * 库里"自动检测"有两种写法：P5 的 `LangSelect` 用 `''`（radix 的 SelectItem 不吃空串，
 * 组件内部换成 `auto` 哨兵再换回来），Task 6 的契约表用 `'auto'` 写过客户行。
 * 只在比较时归一，不改提交值——弹层照原样 PUT，避免顺手把全局行的 `''` 改写成 `'auto'`。
 */
const same = (a: string, b: string): boolean => {
  const n = (v: string): boolean => v === '' || v === 'auto'
  return n(a) && n(b) ? true : a === b
}

/** 保存按钮的 disabled 判定。用 `JSON.stringify` 比会在同义值上谎报改动。 */
export function dirtyCount(base: DirectionSource, next: DirectionSource): number {
  const b = draftOf(base)
  const n = draftOf(next)
  let count = 0
  if (b.receiveEnabled !== n.receiveEnabled) count += 1
  if (!same(b.receiveFromLang, n.receiveFromLang)) count += 1
  if (!same(b.receiveToLang, n.receiveToLang)) count += 1
  if (b.sendEnabled !== n.sendEnabled) count += 1
  if (!same(b.sendFromLang, n.sendFromLang)) count += 1
  if (!same(b.sendToLang, n.sendToLang)) count += 1
  // 线路不进 `same()`：它没有"自动检测"那种同义写法，`''` 也不是合法线路码。
  if (b.channel !== n.channel) count += 1
  return count
}

/** 发信/收信语向的一句话摘要。两个消费方：会话头那颗按钮，与回复框那一行的生效档摘要。 */
export function directionSummary(s: DirectionSource, kind: 'receive' | 'send'): string {
  const from = kind === 'receive' ? s.receiveFromLang : s.sendFromLang
  const to = kind === 'receive' ? s.receiveToLang : s.sendToLang
  if (!to) return '未配置'
  return `${from && from !== 'auto' ? from : 'auto'} → ${to}`
}
