/**
 * 桌面系统通知（A17）的纯规则。
 *
 * 放 shared 是因为它跨两个进程：渲染层按它判「这一帧该不该提请弹窗」，
 * 主进程按同一套口径做跨帧合并与实际弹窗。与 `shared/badge.ts` 同构——
 * 规则本身不许有两份，否则加一条判定条件时一定会漏掉一边。
 */

/** 提请弹窗的输入。渲染层把 LiveFrame 摊平成这一份，主进程不反向依赖渲染层类型。 */
export interface NotifyCandidate {
  /** 设置里的「桌面消息通知」开关。 */
  enabled: boolean
  /** 窗口此刻有没有焦点。与角标同口径：前台不弹。 */
  focused: boolean
  /** 消息方向。只弹收到的——自聊与回声会把通知刷满（spec §9 陷阱 4）。 */
  direction: 'in' | 'out'
  /** 去抖键，用 chatKey：同一会话的连发并成一条。 */
  chatKey: string
  /** 会话显示名（群名或号码）。 */
  title: string
  /** 消息正文，可能为空（纯媒体消息）。 */
  body: string
}

/** 不弹的原因。驱动读它才能区分「规则没生效」与「真的不该弹」。 */
export type NotifySkipReason = 'disabled' | 'focused' | 'outgoing' | 'unsupported'

/**
 * 渲染层提请弹窗的完整请求 = 规则输入 + 定位用的 `accountId`。
 * `accountId` 规则层用不到，但点击通知后要跳到哪个账号只有渲染层知道，所以随帧一起带过来。
 */
export interface NotifyShowRequest extends NotifyCandidate {
  accountId: number
}

export type NotifyDecision =
  | { action: 'skip'; reason: NotifySkipReason }
  | { action: 'show'; chatKey: string; title: string; body: string }

/**
 * 该不该弹。
 *
 * 判定顺序是 `enabled → focused → direction`：开关关了就不用再看焦点，
 * 前台就不必再看方向。三条闸是「与」的关系，不是互相顶掉。
 */
export function notifyDecisionOf(c: NotifyCandidate): NotifyDecision {
  if (!c.enabled) return { action: 'skip', reason: 'disabled' }
  if (c.focused) return { action: 'skip', reason: 'focused' }
  if (c.direction !== 'in') return { action: 'skip', reason: 'outgoing' }
  return { action: 'show', chatKey: c.chatKey, title: c.title, body: c.body }
}

/** 同一会话并成一条的窗口。 */
export const NOTIFY_MERGE_WINDOW_MS = 3000

/** 正文预览上限。通知不是聊天窗，撑满屏的正文没人看。 */
export const NOTIFY_BODY_MAX = 80

/** 空正文（纯媒体消息）的占位。不伪装成有内容，但要让通知不是一条空白。 */
export const NOTIFY_EMPTY_BODY = '[媒体消息]'

export interface NotifyPending {
  chatKey: string
  title: string
  body: string
  /** 合并进来的条数，>=1。 */
  count: number
  /** 这一批第一条到达的时刻（ms）。 */
  firstAt: number
}

/**
 * 把一条新消息并进待弹批次。
 *
 * 同一 chatKey 且在合并窗口内 → 计数累加、正文换成本条（让人看到最新一句）；
 * 跨窗口或换会话 → 重开一批（count=1）。
 * `prev` 为 null 表示这一批还没开始。
 */
export function mergeNotifyPending(
  prev: NotifyPending | null,
  next: { chatKey: string; title: string; body: string },
  now: number
): NotifyPending {
  if (prev && prev.chatKey === next.chatKey && now - prev.firstAt < NOTIFY_MERGE_WINDOW_MS) {
    return { ...prev, title: next.title, body: next.body, count: prev.count + 1 }
  }
  return { chatKey: next.chatKey, title: next.title, body: next.body, count: 1, firstAt: now }
}

/** 通知标题：单条是会话名，多条带条数。 */
export function notifyTitleOf(p: NotifyPending): string {
  if (p.count <= 1) return p.title
  return `${p.title}（${p.count} 条新消息）`
}

/**
 * 通知正文：先把换行与控制字符折成空格，再裁剪。
 *
 * 折行是必需的：复制粘贴来的长文本带一堆 `\n`，不折的话通知会被撑成一大块（spec §9 陷阱 3）。
 */
export function notifyBodyOf(p: NotifyPending): string {
  const flat = p.body.replace(/\s+/g, ' ').trim()
  if (flat === '') return NOTIFY_EMPTY_BODY
  return flat.length <= NOTIFY_BODY_MAX ? flat : `${flat.slice(0, NOTIFY_BODY_MAX)}…`
}

/**
 * 提请弹窗的结论。
 *
 * 与 `NotifyDecision` 分开是因为**弹窗是延迟的**：消息先并进批次，合并窗口到点才真弹。
 * 所以渲染层拿到的是「排进去了」而不是「弹了」，`count` 是当前这一批已并进来的条数。
 */
export type NotifyVerdict =
  | { action: 'skip'; reason: NotifySkipReason }
  | { action: 'queued'; chatKey: string; count: number }

/** 点击某条通知后要交给渲染层的定位信息：跳到哪个账号的哪个会话。 */
export interface NotifyClickTarget {
  accountId: number
  chatKey: string
}

/** 真正弹出去的那一条。flush 的产物，驱动按它断言「合并结果与点击目标对不对」。 */
export interface NotifyShown {
  chatKey: string
  accountId: number
  title: string
  body: string
  count: number
}
