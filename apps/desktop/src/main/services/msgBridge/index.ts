// src/main/services/msgBridge/index.ts
import { getSession } from '../../state/session'
import { getMainWindow } from '../../window/mainWindow'
import { viewManager } from '../../webContentsView/manager'
import { platformOfAccountType } from '@shared/chatPlatform'
import { activeChatKeyOf } from '@shared/chatKeys'
import { msgIdOfSerializedKey } from '@shared/msgIds'
import type {
  BridgeCommand,
  BridgeReport,
  BridgeState,
  LiveFrame,
  RecallReceipt,
  RecallRequest,
  SendReceipt,
  SendRequest,
  StatusFrame
} from '@shared/chatTypes'
import { accountOfId, accountOfView, refreshAccounts, type AccountEntry } from './accountDirectory'
import { BridgeMount } from './bridgeMount'
import { CollectorHub } from './collectorHub'
import { createMsgApi, isSendable } from './msgApi'
import { RecallRegistry, SendAttribution, SendRegistry } from './sendRegistry'
import { SendLock } from './sendLock'
import { settleGroupReply } from '../groupCollect/registry.ts'
import type { GroupEventWire } from '@shared/groupMembers.ts'

/** spec §4 的 msgHistoryLimit：每会话补底条数。 */
export const HISTORY_LIMIT_DEFAULT = 200

/** `StatusUpdateDTO.msgKey` 上的 `@Size(max = 128)`：超长的 key 不是"这一条不更新"，而是整批 400。 */
const MSG_KEY_MAX = 128

/**
 * 一次状态广播带多少把键，与后端 `updates[]` 的 200 上限同量级：整群读回执一条事件能带上几百个
 * id，不切开就是一条无界长的 IPC。切的只是广播，上报那一段原样不动——超出上限的键照样发给后端，
 * 只是不进这一帧。
 * 渲染层 `liveTailSync.ts` 的 `STATUS_KEYS_MAX` 是同一个数字的第二份写法：跨主/渲染两个 tsconfig
 * 边界的常量没有共享点，与 `MSG_KEY_MAX`/`KEY_MAX_LEN` 那一对同理，改任何一处都要改两处。
 */
const STATUS_KEYS_MAX = 200

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
/** invoke 的 Promise 表（localId → 未决），与 `SendAttribution`（数据行归属）各管一件事。 */
const registry = new SendRegistry()
const attribution = new SendAttribution()
const sendLock = new SendLock()
const recallRegistry = new RecallRegistry()

/**
 * B6 群事件 / 建档泵的生命周期钩子。host.ts 在 `startGroupHost()` 时把实现注入进来，
 * 这里只负责在正确的时机调用，不持有任何群状态——避免与 groupCollect 形成循环依赖
 * （api.ts 已经为了切断这个环独立成文件）。
 */
export interface GroupBridgeHooks {
  /** 页内 `group_event` 帧到达（随到随报，不等建档泵）。events 已从帧里取出的一批原始事件。 */
  onFrame(viewId: string, accountId: number, events: GroupEventWire[]): void
  /** 某个账号的桥握手成功：host 在这里触发一次自动建档。 */
  onReady(accountId: number, viewId: string): void
  /** 某个视图掉线 / 销毁：host 在这里结清该视图未决的群命令回执。 */
  onViewDown(viewId: string): void
}

let groupHooks: GroupBridgeHooks | null = null

/** host.ts 在启动 / 退出时注入或撤销群钩子。传 null = 清空（stopGroupHost 用）。 */
export function setGroupHooks(hooks: GroupBridgeHooks | null): void {
  groupHooks = hooks
}

function broadcastState(): void {
  const states = bridgeStates()
  for (const s of states) {
    // 掉线 / 销毁那一刻的未决发送必须结掉，否则回复框永久卡在 pending 气泡上。
    // `dropView` 放在 `failView` 之后：intent 也要一起失效，桥恢复后不该再补认领一条。
    if (s.phase === 'retry' || s.phase === 'offline' || s.phase === 'destroyed') {
      const n = registry.failView(s.viewId, 'BRIDGE_OFFLINE', s.detail ?? '桥未在线')
      attribution.dropView(s.viewId)
    // 撤回与发送共用这一条掉线出口：桥没了，在途那条 invoke 必须当场拿到 ok:false，
    // 不能干等自己的 20s 超时（这里的 detail 会原样进后端的 recall_failed）。
    const m = recallRegistry.failView(s.viewId, s.detail ?? '桥未在线')
    if (n > 0) console.log(`[msgBridge] 结清未决发送 ${n} 条 view=${s.viewId}`)
    // 页内那条 deleteMessage 可能其实成功了，只是回执赶不上这张表——这条日志是唯一能看到那一格的痕迹。
    if (m > 0) console.log(`[msgBridge] 结清未决撤回 ${m} 条 view=${s.viewId}`)
    // 群命令回执的掉线出口：只清这一视图的未决（不连坐别的账号在跑的建档）。
    groupHooks?.onViewDown(s.viewId)
  }
  }
  // 与 `broadcastTheme`/`broadcastSettings` 同一条口径：`getMainWindow()` 可能给回一枚已销毁的窗口，
  // 可选链只防 `null`，防不住它——退出时序里这一句抛过「Object has been destroyed」。
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('msg:state', states)
}

/**
 * 桥状态的唯一组装口：`msg:state` 广播（`broadcastState`）与 `msg:bridges` 初次拉取（`main/ipc.ts`）
 * 都读这里，所以两个出口不可能给渲染层两份不同的"最后已知值"。
 * `activeChatKey` 在这一处补上，不在 `BridgeMount.state()` 里——那条 map 不属于单条桥（P-08）。
 */
export function bridgeStates(): BridgeState[] {
  return [...mounts.values()].map((m) => {
    const core = m.state()
    return { ...core, activeChatKey: activeChatKeyOf(activeChatOf(core.viewId)) }
  })
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
    if (ok) {
      mount.push({ kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
      // 桥 ready = 这个账号可以建档了：通知 host 触发一次自动建档（每账号只触发一次，去重在 host 侧）。
      groupHooks?.onReady(entry.accountId, viewId)
    }
  })
}

/** 注入层每 3s 上报一次登录态：这是主进程唯一知道的"可以挂桥了 / 别采了"信号。 */
export function observeLoginStatus(viewId: string, isLogin: boolean): void {
  if (lastLoginSeen.get(viewId) !== isLogin) {
    lastLoginSeen.set(viewId, isLogin)
    console.log(`[msgBridge] login-status view=${viewId} isLogin=${isLogin}`)
  }
  if (!isLogin) {
    // 登出这一刻，主进程手里就不再有"这个视图在看哪条会话"的可靠答案：清掉，并让渲染层看见这次清除。
    // 广播条件读的是**当前值**而不是"这一帧有没有登录翻转"：注入层每 3s 报一次登录态，
    // 无条件广播会把"登出静置"变成每 3s 一帧 IPC；而只在第一次翻转时广播又会漏掉
    // "先有会话、后报登出"这一格。判"有值可清"两边都覆盖：清完即 null，下一次自然不播。
    const had = activeChatOf(viewId)
    activeChat.set(viewId, null)
    if (had !== null) broadcastState()
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
  // ---- B6 群成员：两条只读命令的回执。只靠 reqId 路由，不依赖 account entry，
  // 所以放在 entry 检查之前——命令是发往有账号的视图的，但回执路由不该因 entry 缺失而丢帧。
  if (report.kind === 'group_list_result' || report.kind === 'group_snapshot_result') {
    if (!settleGroupReply(report)) {
      console.log(`[msgBridge] 群回执无人认领（迟到或已超时）reqId=${report.reqId} kind=${report.kind}`)
    }
    return
  }
  // ---- B6 群事件：页内随到随报的一批进退事件，不等建档泵。这里只负责转交给 host 的攒批器，
  // 不查 account entry 之外的状态——entry 缺失时直接丢（没有账号绑定，事件落不了库）。
  if (report.kind === 'group_event') {
    const e = accountOfView(viewId)
    if (e && report.events.length > 0) groupHooks?.onFrame(viewId, e.accountId, report.events)
    return
  }
  const entry = accountOfView(viewId)
  if (!entry) return
  const mount = mounts.get(viewId)
  if (report.kind === 'message') {
    // 归属盖章（Task 11 Step 2 判定表）：页内一律如实报 live，"是不是本应用发的"在这里判——
    // 主进程两边都知道（localId 是它生成的，msgKey 是它收回的）。命中未决发送改 app_send 并带
    // sendLocalId，未命中才是 native_send；in 行原样返回。
    // 同一条消息只走一条路：先入采集队列，再广播 live 尾巴（spec §4 第 4 条）。
    const frame: LiveFrame = {
      viewId,
      accountId: entry.accountId,
      platform: entry.platform ?? 'whatsapp',
      activeChatKey: activeChatKeyOf(activeChatOf(viewId)),
      message: attribution.stamp(viewId, report.message)
    }
    hub.push(frame)
    getMainWindow()?.webContents.send('msg:live', frame)
    return
  }
  if (report.kind === 'send_result') {
    const meta =
      report.ok && report.msgKey
        ? attribution.settle(report.localId, report.msgKey)
        : (attribution.abandon(report.localId), null)
    registry.settle(report)
    // meta === null 有两种：事件流已经把这一行写进去了，或这条根本不是本应用发的（迟到回执）。
    // 前者再写一次只是给 uk_msg 添压，后者压根不知道该写什么——都不补。
    if (meta?.chatKey && report.msgKey) {
      // 补写那行的 status: 'pending' 是刻意的：这一刻主进程只知道"平台收了单"，之后的
      // sent/delivered/read 由 ack 事件推进（Task 11 Step 6）——落库走 `postStatuses`，页面走
      // 下面 ack 分支广播的 `msg:status`，两条各自单调（`canAdvance` 与后端 `advanceStatus` 同形）。
      // 这一行是主进程手写的 NormalizedMessage 字面量（不是事件流那份），所以裸 id 得自己从
      // 回执的 `_serialized` 里取：少了它，本应用自己发出去的那行 `msg_id` 会是 NULL，
      // 后端按消息定位只能靠 `msg_key` 尾部的 `_out` 模式认它（那两条谓词的分工见 mapper 注释）。
      const msgId = msgIdOfSerializedKey(report.msgKey)
      const frame: LiveFrame = {
        viewId,
        accountId: entry.accountId,
        platform: entry.platform ?? 'whatsapp',
        activeChatKey: activeChatKeyOf(activeChatOf(viewId)),
        message: {
          chatKey: meta.chatKey,
          msgKey: report.msgKey,
          ...(msgId ? { msgId } : {}),
          direction: 'out',
          body: meta.text,
          mediaType: 'text',
          msgTimeEpochSec: Math.floor(Date.now() / 1000),
          status: 'pending',
          source: 'app_send',
          sendLocalId: report.localId
        }
      }
      hub.push(frame)
      // 这一次 flush 是给"本应用自己发出去的那条"开的后门（采集链的批量照旧，那是给风暴用的）：
      // `hub.push` 只进队列，攒到 500 条或 2s 定时器才冲，而 ack 落库是一条 `UPDATE ... WHERE msg_key = ?`
      // ——行还没插进去，UPDATE 就先打空，之后 `INSERT IGNORE` 插进来的那行状态永远停在 `pending`。
      // 这是**结构性次序缺陷**（UPDATE 排在 INSERT 之前），不是我们量到的现象：可达性取决于 ack 相对
      // 批量 flush 的时机，而这条时机在非自聊会话上没量过（自聊拿不到页内回执事件，见 Task 11 的结论）。
      // flush 把窗口从"最多 2s"缩到"一次 HTTP 往返"，**不等于消除**：ack 仍可能比 `postBatch` 返回更早到。
      // 副作用是当时队列里已有的采集帧会被一起冲出去（`drain` 冲的是整个队列），风暴批量被切小、请求条数
      // 变多，正确性不受影响。`flush()` 自己的 `running` 去重在 `CollectorHub` 里，这里不加第二次防抖。
      // 排在广播**之后**：`flush()` 的同步段（`disarm()` 到 `drain()` 起头）万一抛，`.catch` 是接不住同步抛的，
      // 而广播那句才是页面上那口气——先把它送出去，页面不该被一次采集侧的意外连坐。
      getMainWindow()?.webContents.send('msg:live', frame)
      void hub.flush().catch(() => undefined)
    }
    return
  }
  if (report.kind === 'recall_result') {
    // 这一帧的字段与 RecallReceipt 逐字一致（Step 5 就是这么定义的），不需要转手。
    // false 意味着表里已经没有这一格：要么 20s 超时先判了，要么掉线那一刻被 failView 结掉了。
    // 撤回这一侧没有 attribution 那样的第二证人，"答晚了"与"没答"只差这一行日志，不能不放。
    if (!recallRegistry.settle(report)) {
      // localId 是页内回带的，进日志前照 `oneLine` 的口径收：留着控制字符就等于允许伪造日志行。
      console.log(`[msgBridge] 撤回回执无人认领（迟到或已结）localId=${oneLine(report.localId)}`)
    }
    return
  }
  if (report.kind === 'ack') {
    // ack 走自己那份形状（`StatusFrame`）与自己那条通道（`msg:status`），不拼成 `NormalizedMessage`
    // 广播 `msg:live`：这帧没有真的 body / direction / source，而渲染层按 msgKey 合并时是逐字段
    // 覆盖，一帧只有状态的东西会把已有行的方向与正文抹成 null（后端 `ChatMessageMapper.advanceStatus`
    // 的 WHERE 钉着 `direction='out'`，入库侧那行却是各自带 source 的）。
    // 页内那条链是半可信的（被内嵌的视图不一定是我们自己的页面），而合批把一条坏 key 的代价
    // 从"少更一行"放大成"少更一批"，所以在进请求前先把不合法的剔掉、并留一行可数出来的丢弃。
    const raw = Array.isArray(report.msgKeys) ? report.msgKeys : []
    const keys = raw.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MSG_KEY_MAX)
    // 后端 `chatKey` 上是 `@NotBlank`、`updates` 上是 `@NotEmpty`：缺任一个都只是被 `call()` 折成 null 的 400。
    if (!report.chatKey || keys.length === 0) {
      console.log(`[msgBridge] ack 丢弃 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${raw.length}：页内没带 chatKey 或合法 msgKey`)
      return
    }
    if (keys.length !== raw.length) {
      console.log(`[msgBridge] ack 剔除非法 msgKey viewId=${viewId} chat=${oneLine(report.chatKey)} 丢弃=${raw.length - keys.length}`)
    }
    // 两道闸都过了、请求还没发：先把状态推给页面。气泡上的 ⏱→✓→✓✓ 就等这一帧。
    // 为什么不 gate 在下面那个 `r.updated > 0` 上（这是判断，不是省事）：`updated === 0` 的两种原因
    // ——重复回执，或那一行还没落库——里，后者恰恰是最需要页面立刻给出 ✓ 的那种（刚发出去的那条），
    // 拿它当闸会把最常见的一次"刚发出去"的推进整批挡掉。渲染层这条尾巴的状态来源是平台事件本身，
    // 与后端这次返回几条无关；下面 `ack 全批未推进` 那行日志留着，它仍然是"整条 ack 链死了"和
    // "只是重复回执"唯一的区分点。
    // 超出上限只丢广播、不丢上报；帧里只有键与状态词，没有正文可漏（C2/C3）。
    // 这一刀切出来的**分叉方向**是已知的：后端 `MessageStatusDTO.updates` 带 `@Size(max = 200)`，
    // 第 201 把键起整批 400、`postStatuses` 一路折成 null（一行都没落库），而页面这一侧已经按前
    // 200 把键推进过了。今天不修（要修就两头一起想：上报也逐批提交，或后端放宽），记在这儿是
    // 为了让改 `STATUS_KEYS_MAX` 的人知道这个数字同时钉着一条广播与一个 400。
    // 已知限制：尾巴按 `gcTime` 五分钟回收，一条状态**只在尾巴里**推进过、后端那一行没落成的话，
    // 五分钟后重读会退回 `pending` —— 上面 `send_result` 分支那一次 `hub.flush()` 就是为了让这种行尽量不存在。
    getMainWindow()?.webContents.send('msg:status', {
      viewId,
      accountId: entry.accountId,
      platform: entry.platform ?? 'whatsapp',
      chatKey: report.chatKey,
      msgKeys: keys.slice(0, STATUS_KEYS_MAX),
      status: report.status
    } satisfies StatusFrame)
    // 一次页内事件一请求：整群读回执一条事件能带几十上百个 id，拆成一 id 一请求就是几十个
    // 带行锁的并发事务，而 `updates[]` 的 200 上限正是留给这种批的。
    void api
      .postStatuses({
        accountId: entry.accountId,
        chatKey: report.chatKey,
        updates: keys.map((msgKey) => ({ msgKey, status: report.status }))
      })
      .then((r) => {
        if (!r) {
          console.log(`[msgBridge] ack 上报失败 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length}`)
          return
        }
        // 单条 updated:0 是常态（乱序 ack 被阶梯挡住），但**整批一行没动**要么是重复回执、要么是
        // key 的形状与库里那批对不上。这一行日志不区分这两者，但没有它就什么都不区分：
        // "ack 链整条死了"和"只是重复 ack"在日志上长得一模一样。
        if (r.updated === 0) {
          console.log(`[msgBridge] ack 全批未推进 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length} status=${oneLine(report.status)}`)
        }
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
    // 切会话要让工作台那颗按钮跟着翻。不新开 `active-chat-changed` 通道（D-04）：
    // `msg:state` 是"最后已知值"的单一来源，再开一条就等于同一件事有两个真值。
    // 代价是每次切会话多广播一帧（最多 7 个视图、一帧 IPC）。这一支不会被 3s 心跳触发：
    // 页侧只有两处发 `active_chat`——wa-js 的 `chat.active_chat` 事件与 `open_chat` 命令回执
    // （`bridge/whatsapp/collect.ts` 的 `reportActiveChat` / `watchActiveChat`），都是事件驱动。
    broadcastState()
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

/** 渲染层的唯一发送入口：localId 由渲染层生成，主进程只登记不发明。 */
export async function sendText(req: SendRequest): Promise<SendReceipt> {
  const localId = req.localId
  // 正文判定留在最前，那是既有 `sendText` 的报错次序：挪到 viewId 之后会让
  // 「账号没绑视图 + 正文又不合格」这一格从 SEND_FAILED 翻成 BRIDGE_OFFLINE，白改一次语义。
  if (!isSendable(req)) return { localId, ok: false, error: 'SEND_FAILED', detail: '正文为空或超长' }
  const entry = accountOfId(req.accountId)
  const viewId = entry?.viewId
  // 锁挂在 viewId 上：没有 viewId 就没有"哪条链"，直接按离线返回，不进锁也不排队。
  if (!viewId) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '账号没有绑定视图' }
  return sendLock.run(viewId, () => sendTextUnlocked(req, viewId))
}

async function sendTextUnlocked(req: SendRequest, viewId: string): Promise<SendReceipt> {
  const localId = req.localId
  const mount = bridgeOf(viewId)
  if (!mount || !mount.ready) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '会话未在线' }
  const wait = registry.add(localId, viewId)
  attribution.claim(viewId, localId, req.chatKey, req.text)
  mount.push({ kind: 'send', localId, chatKey: req.chatKey, text: req.text })
  return wait.then((receipt) => {
    if (!receipt.ok) attribution.abandon(localId)
    return receipt
  })
}

/** 撤回：localId 由引擎生成，回执走 `recallRegistry` 那张同形但另立的 Promise 表。 */
export async function recallText(req: RecallRequest): Promise<RecallReceipt> {
  const entry = accountOfId(req.accountId)
  const viewId = entry?.viewId
  if (!viewId) return { localId: req.localId, ok: false, detail: '账号没有绑定视图' }
  return sendLock.run(viewId, async () => {
    const mount = bridgeOf(viewId)
    if (!mount || !mount.ready) return { localId: req.localId, ok: false, detail: '会话未在线' }
    const wait = recallRegistry.add(req.localId, viewId)
    mount.push({ kind: 'recall', localId: req.localId, chatKey: req.chatKey, msgKey: req.msgKey })
    return wait
  })
}

/** 「同步历史」按钮：只在桥 ready 时下得去，否则返回 false 让 UI 保持禁用态一致。 */
export function requestBackfill(accountId: number): boolean {
  const viewId = accountOfId(accountId)?.viewId
  if (!viewId) return false
  return pushToBridge(viewId, { kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
}

/**
 * 视图销毁（webContentsView/manager.ts 的 destroyView 调用）：旧 mount 连同它握着的
 * 已销毁 webContents 一起作废，下一次 login-status 观察会在新 contents 上重新挂桥。
 * 不这么做的话 mountOne 会一直复用旧 mount，重挂永远失败。
 */
export function unmountView(viewId: string): void {
  const mount = mounts.get(viewId)
  lastLoginSeen.delete(viewId)
  // 清 map 不依赖"这条视图曾经挂上过桥"：mount 不在也要把活动会话抹掉，
  // 否则同一 viewId 重挂时，上一次的会话会先被广播当成当前值。
  activeChat.delete(viewId)
  // 锁只在真销毁时摘，且不放进 ① 的那条分支——retry/offline 是掉线不是销毁：排队中的 job
  // 已经抓住了自己的 gate，摘掉 tails 会让下一条与它并发上飞，把归属认领的"同视图同会话同文本
  // FIFO"判据摊开。放在早退之前：一条从没挂上桥的 viewId 也不该留下尾链。
  sendLock.dropView(viewId)
  if (!mount) return
  mount.dispose()
  mounts.delete(viewId)
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
  // 未决发送的超时定时器没有 unref：不 dispose 就是退出路上最多 20s 的挂起。
  registry.dispose()
  // 撤回表的超时定时器同样没 unref：不 dispose 就是退出路上最多 20s 的挂起。
  recallRegistry.dispose()
  for (const mount of mounts.values()) mount.dispose()
  mounts.clear()
  activeChat.clear()
  // 退出前把队列里剩下的冲一次。冲不掉也不追：下次启动由补底续上（spec §9）。
  await hub.flush().catch(() => undefined)
  hub.dispose()
}

export const collectorHub = hub
