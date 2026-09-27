export interface MsgState {
  msgId: string
  /** The source text this translation belongs to; a change means the message was edited. */
  text: string
  /** 这条译文当时用的语向。归属判据在首屏渲染期可能先给不出答案，语向变了就要重译。 */
  type: 'send' | 'receive'
  channel: string
  toLang: string
  translation: string | null
  retryCount: number
  /**
   * 这条消息上一次拿到的是降级结果：在线线路掉了或未配密钥，译文其实是本地模拟引擎的原样回显。
   * 它不是译文，所以 `translation` 必为 null、也绝不能当译文画出来；页面上停成一个可点的重试。
   */
  degraded?: boolean
}

const states = new Map<string, MsgState>()

export function getMessageState(msgId: string): MsgState | undefined {
  return states.get(msgId)
}

export function saveMessageState(state: MsgState): void {
  states.set(state.msgId, state)
}

export function clearMessageStates(): void {
  states.clear()
}
