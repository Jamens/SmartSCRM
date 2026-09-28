// src/bridge/whatsapp/recall.ts
import type { BridgeCommand, RecallReceipt } from '../../shared/chatTypes.ts'
import type { WaDeleteResult } from '../types.ts'

export type RecallCmd = Extract<BridgeCommand, { kind: 'recall' }>

/** 返回类型只在 `bridge/types.ts` 声明一次（R32）；这里换个名字给本文件用，不再抄一遍字段。 */
export type DeleteResult = WaDeleteResult

export interface RecallChat {
  deleteMessage(chatId: string, ids: string, deleteMediaInDevice?: boolean, revoke?: boolean): Promise<DeleteResult>
}

/**
 * 剥 `_out` 只发生在**入参**这一步：`msgKey` 列存的仍是回执原样（与 whatsapp/send.ts 的
 * "key 原样用"配套——原样那串要和事件流那条逐字相等，而去尾这串才是 deleteMessage 认的）。
 * 同一个尾在 `shared/msgIds.ts` 里也有一份常量，但那边的操作是"取末段裸 id"，与这里的
 * "整串去尾"不是同一件事，所以不复用那个函数（R33）。
 */
export const bareMsgKey = (msgKey: string): string => msgKey.replace(/_out$/, '')

export async function recallViaWa(cmd: RecallCmd, chat: RecallChat | undefined): Promise<RecallReceipt> {
  if (!chat) return { localId: cmd.localId, ok: false, detail: 'WPP.chat.deleteMessage 不可用' }
  try {
    const result = await chat.deleteMessage(cmd.chatKey, bareMsgKey(cmd.msgKey), false, true)
    // 只有 isRevoked 才是"对所有人撤回"成功；isDeleted 只说明本机那条没了。
    if (result?.isRevoked !== true) {
      return {
        localId: cmd.localId,
        ok: false,
        isRevoked: false,
        detail: `isRevoked=${String(result?.isRevoked)} isDeleted=${String(result?.isDeleted)}`
      }
    }
    return { localId: cmd.localId, ok: true, isRevoked: true }
  } catch (e) {
    return { localId: cmd.localId, ok: false, isRevoked: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
