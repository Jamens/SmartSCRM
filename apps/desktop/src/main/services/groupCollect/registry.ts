// src/main/services/groupCollect/registry.ts
//
// 群命令回执的未决表。桥的 `group_list_result` / `group_snapshot_result` 帧带 reqId 上行，
// 这里按 reqId 把 Promise 了结。独立成文件以切断与 msgBridge 的循环引用：
// api.ts 从 msgBridge 取 accountOfId/bridgeOf/pushToBridge，msgBridge 的 handleBridgeReport
// 只从这里取 settleGroupReply——若放在 api.ts 里就会形成环。

import type { GroupCommand, GroupReply } from './engine.ts'

interface Pending {
  resolve: (r: GroupReply) => void
  timer: NodeJS.Timeout
  /** 这条未决回执来自哪个视图：视图掉线时只清它自己的，不动别的账号在跑的建档（见 failView）。 */
  viewId: string
}

const table = new Map<string, Pending>()

function timeoutReplyFor(): GroupReply {
  return { kind: 'group_list_result', ok: false, error: 'VIEW_GONE' }
}

function timeoutReply(cmd: GroupCommand): GroupReply {
  if (cmd.kind === 'group_list') return { kind: 'group_list_result', ok: false, error: 'TIMEOUT' }
  return { kind: 'group_snapshot_result', chatKey: cmd.chatKey, ok: false, error: 'TIMEOUT' }
}

/**
 * 注册一个未决回执。超时由 dispatch 侧用 setTimeout 触发 drop + resolve(失败回执)。
 * `viewId` 要带上——视图掉线时 failView 只清这一视图的未决，不连坐别的账号在跑的建档。
 */
export function addPending(reqId: string, viewId: string, resolve: (r: GroupReply) => void, timer: NodeJS.Timeout): void {
  table.set(reqId, { resolve, timer, viewId })
}

/**
 * 视图销毁 / 桥掉线：只结清「这个视图」的未决群回执（视图没了，它的回执不可能再来）。
 * 不按 accountId 过滤、也不 failAll：同一时刻可能两个账号各跑着一轮建档，
 * 其中一个的桥掉线不该把另一个在途的那一步也结掉（那会让无辜的那轮无端重试）。
 */
export function failView(viewId: string): number {
  let n = 0
  for (const [reqId, e] of [...table]) {
    if (e.viewId !== viewId) continue
    clearTimeout(e.timer)
    e.resolve(timeoutReplyFor())
    table.delete(reqId)
    n++
  }
  return n
}

/** 超时或视图销毁时调用：清掉计时器。resolve 由调用方负责。 */
export function dropPending(reqId: string): void {
  const e = table.get(reqId)
  if (!e) return
  clearTimeout(e.timer)
  table.delete(reqId)
}

/** 桥回执到达时调用。命中未决表才 true；迟到/无关的由调用方另作处理。 */
export function settleGroupReply(report: GroupReply & { reqId: string }): boolean {
  const e = table.get(report.reqId)
  if (!e) return false
  clearTimeout(e.timer)
  table.delete(report.reqId)
  e.resolve(report)
  return true
}

/**
 * 视图销毁 / 桥掉线：把所有未决结掉（视图没了，回执不可能再来）。
 * 不按 viewId 过滤——泵按账号串行、调用方持 accountId，视图一旦没了就整张表作废最省事。
 */
export function failAllPending(): number {
  let n = 0
  for (const [, e] of table) {
    clearTimeout(e.timer)
    e.resolve(timeoutReplyFor())
    n++
  }
  table.clear()
  return n
}

export { timeoutReply }
export function size(): number {
  return table.size
}
