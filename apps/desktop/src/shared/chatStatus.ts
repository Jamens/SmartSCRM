// src/shared/chatStatus.ts
import type { Direction, MsgStatus } from './chatTypes.ts'

/**
 * WhatsApp 页内 `MsgModel.ack` 的取值。只在这里出现一次：
 * Java 侧收到的已经是翻译好的状态词（收敛 #3、#12），不重复这套数字。
 * 装包后用 `grep -n "Ack" node_modules/@wppconnect/wa-js/dist/*.d.ts` 复核（Task 8 Step 1）。
 */
export const WA_ACK = {
  FAILED: -1,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  PLAYED: 4
} as const

const LADDER: readonly MsgStatus[] = ['pending', 'sent', 'delivered', 'read']

export function rankOf(status: string): number {
  return LADDER.indexOf(status as MsgStatus)
}

export function fromAck(ack: number | undefined | null, direction: Direction): MsgStatus {
  if (direction === 'in') return 'received'
  switch (ack) {
    case WA_ACK.FAILED:
      return 'failed'
    case WA_ACK.SENT:
      return 'sent'
    case WA_ACK.DELIVERED:
      return 'delivered'
    case WA_ACK.READ:
    case WA_ACK.PLAYED:
      return 'read'
    default:
      return 'pending'
  }
}

/**
 * `ChatMessageMapper.advanceStatus` 里那段 `FIELD()` 比较的 TS 同形实现。
 * 两边各写一次是有意的：页内要用它决定"这条 ack 事件值不值得上报"，
 * 后端要用它决定"这次更新值不值得写库"。测试把同一组断言喂给两边。
 */
export function canAdvance(from: string, to: string): boolean {
  if (to === 'failed') return from === 'pending' || from === 'sent'
  const f = rankOf(from)
  const t = rankOf(to)
  return f >= 0 && t > f
}
