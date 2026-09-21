// src/main/services/msgBridge/index.ts
import { getSession } from '../../state/session'
import { getMainWindow } from '../../window/mainWindow'
import { viewManager } from '../../webContentsView/manager'
import { platformOfAccountType } from '@shared/chatPlatform'
import type { BridgeCommand, BridgeReport, BridgeState, LiveFrame, NormalizedMessage } from '@shared/chatTypes'
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
/** 每视图上一次观察到的登录态：日志只在值翻转时打，掐掉注入层 3s 一次的刷屏。 */
const lastLoginSeen = new Map<string, boolean>()
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
  if (lastLoginSeen.get(viewId) !== isLogin) {
    lastLoginSeen.set(viewId, isLogin)
    console.log(`[msgBridge] login-status view=${viewId} isLogin=${isLogin}`)
  }
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

/**
 * 归属盖章（Task 11 brief Step 2 的判定表）：页内一律如实报 live，"是不是本应用发的"在这里判——
 * 主进程两边都知道（localId 是它生成的，msgKey 是它收回的）。发送链（Task 12）落地时在同一处
 * 加 SendRegistry 匹配：命中未决发送改 app_send 并带 sendLocalId，未命中才是 native_send。
 */
function stampOutboundSource(message: NormalizedMessage): NormalizedMessage {
  if (message.direction === 'out' && message.source === 'live') return { ...message, source: 'native_send' }
  return message
}

/** 页内来的文本进主进程日志前收成一行：留着换行就等于允许伪造日志行，长度也不该无界。 */
function oneLine(text: string | undefined, max = 200): string {
  // \v \f 之类也算换行（Chrome 的 console 会把它们断行），所以按 C0 控制字符整体收。
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max)
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
      message: stampOutboundSource(report.message)
    }
    hub.push(frame)
    getMainWindow()?.webContents.send('msg:live', frame)
    return
  }
  if (report.kind === 'ack') {
    // ack 只推后端状态，不广播 msg:live：这帧没有真的 body / direction / source，
    // 拼成 NormalizedMessage 会让渲染层按 msgKey 合并时把已有行的方向与归属改脏
    // （`advanceStatus` 的 WHERE 钉着 `direction='out'`，入库侧的行却是各自带 source 的）。
    // Task 15 要做气泡对勾时，另立一个"状态帧"形状，别复用消息类型。
    const keys = Array.isArray(report.msgKeys) ? report.msgKeys : []
    // 后端 `chatKey` 上是 `@NotBlank`、`updates` 上是 `@NotEmpty`：缺任一个都只是被 `call()` 折成 null 的 400。
    if (!report.chatKey || keys.length === 0) {
      console.log(`[msgBridge] ack 丢弃 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length}：页内没带 chatKey 或 msgKey`)
      return
    }
    // 一次页内事件一请求：整群读回执一条事件能带几十上百个 id，拆成一 id 一请求就是几十个
    // 带行锁的并发事务，而 `updates[]` 的 200 上限正是留给这种批的。
    void api
      .postStatuses({
        accountId: entry.accountId,
        chatKey: report.chatKey,
        updates: keys.map((msgKey) => ({ msgKey, status: report.status }))
      })
      .then((r) => {
        // updated:0 是常态（乱序 ack 被阶梯挡住），只有"整条请求没成"才值得刷屏。
        if (!r) console.log(`[msgBridge] ack 上报失败 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length}`)
      })
    return
  }
  if (report.kind === 'backfill_progress' || report.kind === 'backfill_gap') {
    // 只进主进程日志：计数与 chatKey，不含正文（C3）。页内来的文本（chatKey / reason）一律
    // 经 oneLine：不截会刷出无界长行，留换行则能被伪造日志行。
    // droppedTotal 是 CollectorHub 的进程累计丢弃数，不是本轮的：本轮看 msgs=。
    console.log(
      report.kind === 'backfill_gap'
        ? `[msgBridge] backfill 跳过 viewId=${viewId} chat=${oneLine(report.chatKey)} reason=${oneLine(report.reason)}`
        : `[msgBridge] backfill 进度 viewId=${viewId} ${report.chatsDone}/${report.chatsTotal} msgs=${report.messages} droppedTotal=${hub.dropped}`
    )
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
  lastLoginSeen.delete(viewId)
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
