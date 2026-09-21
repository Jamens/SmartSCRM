// src/bridge/index.ts —— 握手 + 心跳应答 + 采集接线（whatsapp 一支；telegram 在 Task 12c 登记）
import { makeThrottledReporter, onCommand, report } from './host.ts'
import * as whatsappCollect from './whatsapp/collect.ts'
import type { BridgeCommand, BridgeInstallConfig } from '../shared/chatTypes.ts'
import type { ChatPlatform } from '../shared/chatPlatform.ts'
import type { CollectCtx, CollectImpl } from './types.ts'

/**
 * 采集实现按平台查表，本任务只有 whatsapp 一项。用查表而不是在四个 case 里各判一次平台：
 * 一条命令的处理必须整体来自同一个实现，半 WA 半 TG 的混合体最坏处会采出混合形状的数据。
 * Task 12c 往这张表里加 telegram 一项，不改这里的取用方式。
 */
const COLLECT: Partial<Record<ChatPlatform, CollectImpl>> = { whatsapp: whatsappCollect }

let installed: BridgeInstallConfig | null = null
let offCommand: (() => void) | null = null
/** 装好后由 mount 调用；send / backfill / open_chat 的 case 在 Task 12 / 14 里补。 */
let handle: ((cmd: BridgeCommand) => void) | null = null
let collectorRef: (() => void) | null = null
let activeRef: (() => void) | null = null
let pushRef: ReturnType<typeof makeThrottledReporter> | null = null
/**
 * 补底轮次代号：每来一轮新的 backfill、每次 destroy 都推进它。
 * `cancel()` 只撤当前在途的合帧定时器，拦不住还在 `await` 里的上一轮循环——它下一趟会重新起一个
 * 定时器把帧塞出去（心跳重挂后就是两个循环共用一个 reporter，或卸载后仍有帧出 IPC）。代号停不掉
 * 循环本身——页内没有 abort 信号可递给 `getMessages`——它保证的是另一头：老轮次的帧一律出不去。
 */
let backfillSeq = 0

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
        // Task 12 落地；现在收到就明确报失败，不要静默。
        push({ kind: 'send_result', localId: cmd.localId, ok: false, error: 'SEND_FAILED', detail: 'send not wired yet' })
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
