export interface MsgState {
  msgId: string
  /** The source text this translation belongs to; a change means the message was edited. */
  text: string
  channel: string
  toLang: string
  translation: string | null
  retryCount: number
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
