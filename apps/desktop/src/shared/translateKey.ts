// src/shared/translateKey.ts
export interface TranslateKeyInput {
  type: 'send' | 'receive'
  input?: boolean
  chatHint?: string | null
  text: string
}

/**
 * 同一段原文在两个会话里可能走两个语向（生效面 ②）。inflight 去重键必须把会话算进去：
 * 少了它，切会话时后到的那次会复用前一会话的 promise，把上一个会话客户的语种画到
 * 这个会话的气泡上，而 `isTranslated` 会把画错的那一行一直留着。
 *
 * `chatHint` 是页内能给出的**会话提示**（平台自己给的名字/标题一类），不是 `chatKey`：
 * 注入层不读平台内部对象，真正的 `chatKey` 由主进程盖章、只有主进程那份进后端。
 * 提示撞车（两个会话同名）时最多退化成今天的共用一次 promise，不会比现状更坏。
 */
export function translateKey(req: TranslateKeyInput): string {
  return `${req.type}|${req.input === true ? 'i' : 'f'}|${req.chatHint ?? ''}|${req.text}`
}
