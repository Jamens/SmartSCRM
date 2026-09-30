// src/bridge/index.ts —— 握手 + 心跳应答 + 采集接线（whatsapp 一支；telegram 在 Task 12c 登记）
import { makeThrottledReporter, onCommand, report } from './host.ts'
import * as whatsappCollect from './whatsapp/collect.ts'
import { listGroups, snapshotGroup, subscribeGroupEvents } from './whatsapp/groups.ts'
import { sendViaWa } from './whatsapp/send.ts'
import { recallViaWa } from './whatsapp/recall.ts'
import type { BridgeCommand, BridgeInstallConfig } from '../shared/chatTypes.ts'
import type { ChatPlatform } from '../shared/chatPlatform.ts'
import type { CollectCtx, CollectImpl, WppChatApi, WppLike } from './types.ts'

/**
 * 采集实现按平台查表，本任务只有 whatsapp 一项。用查表而不是在四个 case 里各判一次平台：
 * 一条命令的处理必须整体来自同一个实现，半 WA 半 TG 的混合体最坏处会采出混合形状的数据。
 * Task 12c 往这张表里加 telegram 一项，不改这里的取用方式。
 */
const COLLECT: Partial<Record<ChatPlatform, CollectImpl>> = { whatsapp: whatsappCollect }

let installed: BridgeInstallConfig | null = null
let offCommand: (() => void) | null = null
/** 装好后由 mount 调用；四条命令 case 齐了（send 在 Task 12 接上真发送）。 */
let handle: ((cmd: BridgeCommand) => void) | null = null
let collectorRef: (() => void) | null = null
let activeRef: (() => void) | null = null
/** 群成员在线事件的取消订阅；随 destroy 一起走，否则卸载后事件还会往主进程打。 */
let groupEventsRef: (() => void) | null = null
let pushRef: ReturnType<typeof makeThrottledReporter> | null = null
/**
 * 补底轮次代号：每来一轮新的 backfill、每次 destroy 都推进它。
 * `cancel()` 只撤当前在途的合帧定时器，拦不住还在 `await` 里的上一轮循环——它下一趟会重新起一个
 * 定时器把帧塞出去（心跳重挂后就是两个循环共用一个 reporter，或卸载后仍有帧出 IPC）。代号停不掉
 * 循环本身——页内没有 abort 信号可递给 `getMessages`——它保证的是另一头：老轮次的帧一律出不去。
 */
let backfillSeq = 0

/** 发送这一路只在这里碰 `window.WPP`：`sendViaWa` 吃的是 chat 对象，测试给假的即可。 */
const wppChat = (): WppChatApi | undefined =>
  typeof window !== 'undefined' && window.WPP ? window.WPP.chat : undefined

/**
 * 群成员这一路拿整个 `window.WPP`（要 group / contact / on 三处，不是一个子对象）。
 * 与 wppChat 同口径：只在这里碰全局，叶子模块吃传进来的句柄，测试给假对象即可。
 */
const wppAll = (): WppLike | undefined =>
  typeof window !== 'undefined' ? window.WPP : undefined

export function install(config: BridgeInstallConfig): boolean {
  if (installed && installed.bridgeVersion === config.bridgeVersion) return false
  const impl = COLLECT[config.platform]
  if (!impl) {
    // 挂载闸门（Task 10）挡的就是"这个平台有没有采集实现"，走到这里说明两处不同步了。
    // 抛出去让握手失败，主进程按 retry → offline 收敛，比挂一条"ready 却永远采不到"的桥好查得多。
    // 必须在改任何状态之前抛：先记 installed 的话，模块就自称装好了却没有任何 handler，
    // 而同 bridgeVersion 的下一次 install 会在上面那行直接 return false，永远不再 ready。
    throw new Error(`bridge: 该平台没有采集实现 ${config.platform}`)
  }
  destroy()
  installed = config
  const push = makeThrottledReporter()
  pushRef = push
  const collector = impl.startLiveCollect({ emit: push })
  const stopActiveWatch = impl.watchActiveChat({ emit: push })
  /**
   * 群成员在线事件（spec §4）。与消息采集是两条独立的订阅：
   * 它只在页面在线并处理到那条 action 时才报，离线时段的变更靠快照 diff 兜。
   * 订阅失败不抛——页内没有这个事件不该让整条桥挂掉，主进程有建档泵的空名单缺口兜住。
   */
  groupEventsRef = subscribeGroupEvents(wppAll(), push)
  handle = (cmd: BridgeCommand): void => {
    switch (cmd.kind) {
      case 'ping':
        push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
        return
      case 'backfill': {
        // 补底是异步的且不阻塞命令回路：期间新消息仍走 live 事件，幂等交给 uk_msg。
        const seq = ++backfillSeq
        const emit: CollectCtx['emit'] = (r) => {
          if (seq === backfillSeq) push(r)
        }
        // 循环里逃出来的异常折成一帧 gap：不接住就是 unhandled rejection，整轮采集静默消失。
        void impl.runBackfill(cmd.limit, { emit }).catch((e: unknown) => {
          emit({ kind: 'backfill_gap', chatKey: '*', reason: e instanceof Error ? e.message : String(e) })
        })
        return
      }
      case 'open_chat':
        impl.reportActiveChat({ emit: push })
        return
      case 'send':
        // 不 await：命令回路是同步的，await 会让后面的 ping 排在这条消息后面。
        void sendViaWa(cmd, wppChat()).then((receipt) => {
          push({ kind: 'send_result', ...receipt })
        })
        return
      case 'recall':
        // 与 send 同样不 await：命令回路是同步的。
        void recallViaWa(cmd, wppChat()).then((receipt) => {
          push({ kind: 'recall_result', ...receipt })
        })
        return
      /**
       * 两条只读命令，都不 await（同上），且都**不进 sendLock**：
       * 采集不冒充发送方，群成员采集连页面状态都不改。
       */
      case 'group_list':
        void listGroups(wppAll()).then((r) => {
          push({ kind: 'group_list_result', reqId: cmd.reqId, ...r })
        })
        return
      case 'group_snapshot':
        void snapshotGroup(wppAll(), cmd.chatKey).then((r) => {
          push({ kind: 'group_snapshot_result', reqId: cmd.reqId, chatKey: cmd.chatKey, ...r })
        })
        return
    }
  }
  offCommand = onCommand((cmd) => handle?.(cmd))
  collectorRef = collector
  activeRef = stopActiveWatch
  // 同步返回值给主进程：见 plan 注释——pong 在 ready 前，返回值 true 是最快的确认
  push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
  report({ kind: 'ready', bridgeVersion: config.bridgeVersion })
  impl.reportActiveChat({ emit: push })
  return true
}

export function destroy(): void {
  // 每一步都要容错：真实页面里 wa-js 的 off() 会在钩子已随热更新作废时抛
  // "removeListener only takes instances of Function"（2026-09-22 实测）。
  // 任何一步抛出去都会让后面的步骤（含 cancel 与 installed 置空）跳过，
  // 桥就变成"僵尸"——pong 还在、采集已停，主进程永远不重挂。
  try {
    offCommand?.()
  } catch {
    /* 页面已经把钩子拆了：没什么可做的 */
  }
  offCommand = null
  tryCall(collectorRef)
  tryCall(activeRef)
  tryCall(groupEventsRef)
  groupEventsRef = null
  // 先停钩子再撤定时器：destroy 之后不允许再有在途的 backfill_progress 出 IPC。
  pushRef?.cancel()
  // 在跑的补底循环还活在 await 里，下一趟就会重新起一个定时器。推进代号让它剩下的帧全部作废。
  backfillSeq += 1
  pushRef = null
  handle = null
  installed = null
}

function tryCall(fn: (() => void) | null): void {
  try {
    fn?.()
  } catch {
    /* 同上：拆一半的钩子不值得为它停掉整个卸载流程 */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__SCRM_BRIDGE_DESTROY__ = (): void => {
  destroy()
}
