// src/main/services/msgBridge/index.ts
import { getSession } from '../../state/session'
import { getMainWindow } from '../../window/mainWindow'
import { viewManager } from '../../webContentsView/manager'
import { platformOfAccountType } from '@shared/chatPlatform'
import type { BridgeCommand, BridgeReport, BridgeState, LiveFrame } from '@shared/chatTypes'
import { accountOfView, refreshAccounts, type AccountEntry } from './accountDirectory'
import { BridgeMount } from './bridgeMount'
import { CollectorHub } from './collectorHub'
import { createMsgApi } from './msgApi'

/** spec §4 的 msgHistoryLimit：每会话补底条数。 */
export const HISTORY_LIMIT_DEFAULT = 200

const api = createMsgApi({ token: () => getSession()?.accessToken ?? null })

const hub = new CollectorHub({
  flush: async (payload) => {
    const result = await api.postBatch(payload)
    // 后端不可用与业务拒绝都不该抛：抛出去会让 CollectorHub 走"退回重试"，
    // 而 40300 这类拒绝重试一万次也不会成功。
    if (!result) throw new Error('batch rejected')
    return result
  }
})

const mounts = new Map<string, BridgeMount>()
const activeChat = new Map<string, string | null>()
let refreshTimer: NodeJS.Timeout | null = null

function broadcastState(): void {
  getMainWindow()?.webContents.send('msg:state', bridgeStates())
}

export function bridgeStates(): BridgeState[] {
  return [...mounts.values()].map((m) => m.state())
}

export function activeChatOf(viewId: string): string | null {
  return activeChat.get(viewId) ?? null
}

function mountOne(entry: AccountEntry, viewId: string): void {
  // 闸门按"这个平台有没有页内采集实现"过，不按"平台认不认识"过。本任务只登记 whatsapp（Task 11）。
  // 不能写成 `if (!platform) return`：`platformOfAccountType` 只把 1/4 映射成采集平台，Facebook /
  // Messenger 天然是 null 被挡下；但"认得"不等于"接得上"：真接 TG 的是 bridge/index.ts 里那次分派，
  // 那里没登记 telegram 时，TG 视图会挂上一条没有 collect 实现的空桥——握手会 ready、心跳会 pong，
  // 却永远采不到东西，比"压根没挂"难查得多。所以 telegram 进这一行必须与 Task 12c 的那次分派同批落地。
  const platform = platformOfAccountType(entry.platformType)
  if (platform !== 'whatsapp') return
  const existing = mounts.get(viewId)
  if (existing) {
    void existing.mount()
    return
  }
  const wc = viewManager.webContentsOf(viewId)
  if (!wc) return
  console.log(`[msgBridge] 挂载账号 account=${entry.accountId} view=${viewId} platform=${platform}`)
  const mount = new BridgeMount({
    viewId,
    accountId: entry.accountId,
    platform,
    historyLimit: HISTORY_LIMIT_DEFAULT,
    webContents: wc,
    onState: broadcastState,
    pushToView: (id, cmd) => viewManager.sendToView(id, 'msg-cmd', cmd)
  })
  mounts.set(viewId, mount)
  void mount.mount().then((ok) => {
    // 握手成功才补底：没 ready 就发 backfill 命令，桥还没挂上钩子，等于白发。
    if (ok) mount.push({ kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
  })
}

/** 注入层每 3s 上报一次登录态：这是主进程唯一知道的"可以挂桥了 / 别采了"信号。 */
export function observeLoginStatus(viewId: string, isLogin: boolean): void {
  console.log(`[msgBridge] login-status view=${viewId} isLogin=${isLogin}`)
  if (!isLogin) {
    activeChat.set(viewId, null)
    return
  }
  const known = accountOfView(viewId)
  if (known) {
    if (!mounts.has(viewId)) mountOne(known, viewId)
    else mounts.get(viewId)?.push({ kind: 'ping' })
    return
  }
  void refreshAccounts(true).then((rows) => {
    const entry = rows.find((r) => r.viewId === viewId)
    if (entry && !mounts.has(viewId)) mountOne(entry, viewId)
  })
}

/** 页 → 主。通道名 `msg-report`，白名单在 webContentsView/ipc.ts。 */
export function handleBridgeReport(viewId: string, data: unknown): void {
  const report = data as BridgeReport | null
  if (!report || typeof report !== 'object' || typeof report.kind !== 'string') return
  const entry = accountOfView(viewId)
  if (!entry) return
  const mount = mounts.get(viewId)
  if (report.kind === 'message') {
    // 同一条消息只走一条路：先入采集队列，再广播 live 尾巴（spec §4 第 4 条）。
    const frame: LiveFrame = {
      viewId,
      accountId: entry.accountId,
      platform: entry.platform ?? 'whatsapp',
      activeChatKey: activeChatOf(viewId),
      message: report.message
    }
    hub.push(frame)
    getMainWindow()?.webContents.send('msg:live', frame)
    return
  }
  if (report.kind === 'active_chat') {
    activeChat.set(viewId, report.chatKey ?? null)
    return
  }
  mount?.handle(report)
}

export function pushToBridge(viewId: string, cmd: BridgeCommand): boolean {
  const mount = mounts.get(viewId)
  if (!mount || !mount.ready) return false
  mount.push(cmd)
  return true
}

/** 记录页与离线态判定都要用：桥在不在，决定回复框能不能敲。 */
export function bridgeOf(viewId: string): BridgeMount | null {
  return mounts.get(viewId) ?? null
}

/**
 * 视图销毁（webContentsView/manager.ts 的 destroyView 调用）：旧 mount 连同它握着的
 * 已销毁 webContents 一起作废，下一次 login-status 观察会在新 contents 上重新挂桥。
 * 不这么做的话 mountOne 会一直复用旧 mount，重挂永远失败。
 */
export function unmountView(viewId: string): void {
  const mount = mounts.get(viewId)
  if (!mount) return
  mount.dispose()
  mounts.delete(viewId)
  activeChat.delete(viewId)
  broadcastState()
}

export function startMsgBridge(): void {
  if (refreshTimer) return
  refreshTimer = setInterval(() => void refreshAccounts(true), 5 * 60_000)
  refreshTimer.unref()
  void refreshAccounts(true).then(() => broadcastState())
}

export async function stopMsgBridge(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  for (const mount of mounts.values()) mount.dispose()
  mounts.clear()
  activeChat.clear()
  // 退出前把队列里剩下的冲一次。冲不掉也不追：下次启动由补底续上（spec §9）。
  await hub.flush().catch(() => undefined)
  hub.dispose()
}

export const collectorHub = hub
