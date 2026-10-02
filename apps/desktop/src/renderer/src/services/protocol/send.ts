// src/renderer/src/services/protocol/send.ts
// 渲染层出站发送分发入口（B27 出站腿）。
//
// type-7（WA 协议号）账号没有 WebContentsView、不绑定 viewId，不能走主进程 msgBridge.sendText
// 那条 WebContentsView 桥路径（那条会 empty viewId -> BRIDGE_OFFLINE）。协议号是渲染进程原生
// 直连外部协议网关（与入站同形态），所以出站也在这里直接调已建立的网关 client。
//
// 返回的 SendReceipt 与网页 WA 桥同形，useSendText 可直接复用 sendError.outcomeOf 转成 UI 成败。

import type { SendReceipt } from '@shared/chatTypes.ts'
import { getActiveProtocolManager } from './manager.ts'

/**
 * 通过活跃 ProtocolSyncManager 发送一条出站消息。
 * manager 未就绪（未登录 / 协议号同步未启动）时返回 BRIDGE_OFFLINE，与网页桥离线态一致，
 * 让 ReplyComposer 的离线提示逻辑无需分支。
 */
export async function sendViaProtocol(
  accountId: number,
  chatKey: string,
  text: string
): Promise<SendReceipt> {
  const mgr = getActiveProtocolManager()
  if (!mgr) {
    return { localId: '', ok: false, error: 'BRIDGE_OFFLINE', detail: '协议号同步未就绪' }
  }
  return mgr.send(accountId, chatKey, text)
}
