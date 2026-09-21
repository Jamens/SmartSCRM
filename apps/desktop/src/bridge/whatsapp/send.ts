// src/bridge/whatsapp/send.ts
import type { BridgeCommand, SendError, SendReceipt } from '../../shared/chatTypes.ts'
import type { SendChatResult } from '../types.ts'

export type SendCmd = Extract<BridgeCommand, { kind: 'send' }>

/** 只依赖发送这一件事，测试用假对象即可，不需要真的 WPP。 */
export interface SendChat {
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
}

/**
 * 错误码分类。wa-js 抛的是普通 Error，文案随版本变，所以这里只是尽力归类：
 * 认不出一律 SEND_FAILED。真实分类词在真机"坏 chatKey"那一档实测，不符就回来补正则。
 */
export function classify(err: unknown): SendError {
  const text = err instanceof Error ? err.message : String(err)
  return /chat|recipient|participant|number|not found|invalid|404|cannot send/i.test(text)
    ? 'CHAT_NOT_FOUND'
    : 'SEND_FAILED'
}

/**
 * 回执里的 key **原样用**，不去 `_out` 后缀、不剥前缀：这一串要与事件流那条的
 * `MsgModel.id._serialized` 逐字相等，后端 `uk_msg` 才认得出是同一行（主进程的归属登记与
 * 补写全靠这一致性）。去尾只属于页内 API 的入参（`deleteMessage` 要的是去掉 `_out` 的那串）。
 */
export function receiptFrom(cmd: SendCmd, result: SendChatResult | null | undefined, err: unknown): SendReceipt {
  if (err) {
    return {
      localId: cmd.localId,
      ok: false,
      error: classify(err),
      detail: err instanceof Error ? err.message : String(err)
    }
  }
  const msgKey = result?.id ?? ''
  // 没有 msgKey 就当失败：主进程无法把这一行与 localId 关联，成功返回只会造出一条查不到的幽灵气泡。
  if (!msgKey) return { localId: cmd.localId, ok: false, error: 'SEND_FAILED', detail: '平台未返回 msgKey' }
  return { localId: cmd.localId, ok: true, msgKey }
}

/**
 * `waitForAck: false`——回执要快，状态推进交给 ack 事件流（Task 11 的 msg_ack_change）。
 * 选项名以 Step 1 的 grep 结果为准。
 */
export async function sendViaWa(cmd: SendCmd, chat: SendChat | undefined): Promise<SendReceipt> {
  if (!chat) return { localId: cmd.localId, ok: false, error: 'BRIDGE_OFFLINE', detail: 'WPP.chat 不可用' }
  try {
    const result = await chat.sendTextMessage(cmd.chatKey, cmd.text, { createChat: true, waitForAck: false })
    return receiptFrom(cmd, result, null)
  } catch (e) {
    return receiptFrom(cmd, null, e)
  }
}
