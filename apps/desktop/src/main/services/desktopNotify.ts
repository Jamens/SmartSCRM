// 相对路径而非 `@shared` 别名：本模块要被 `node --test` 直接跑，裸 node 不认 tsconfig 的
// paths。与 `groupCollect/export.ts`、`groupCollect/collector.ts` 同一条约定。
import {
  NOTIFY_MERGE_WINDOW_MS,
  mergeNotifyPending,
  notifyBodyOf,
  notifyDecisionOf,
  notifyTitleOf,
  type NotifyPending,
  type NotifyShowRequest,
  type NotifyShown,
  type NotifyVerdict
} from '../../shared/notification.ts'

/**
 * 桌面系统通知（A17）的主进程这一半。
 *
 * **本模块不 import electron**——与 `groupCollect/export.ts` 同一条约定：要单测的模块不碰 electron，
 * 平台那一层（构造 `Notification`、判 `isSupported`）由 `ipc.ts` 注入进来。否则这条服务
 * 只能在真的 Electron 环境里被断言，而那正是最难覆盖的一类。
 *
 * 为什么去抖合并必须在这里：渲染层每条消息都会来一帧，而合并要"跨帧累积"——
 * 那个状态若放在渲染层，会因为组件重挂载（路由切换、热更新）丢掉一半，
 * 表现是"去抖时灵时不灵"，是最难查的一类 bug。主进程常驻，是唯一稳的落脚点。
 */

/**
 * 平台能力。由 `ipc.ts` 用真的 Electron `Notification` 装配。
 * `present` 的第二个参数是"用户点了这条通知"的回调，由平台侧在 click 时触发。
 */
export interface NotifyHost {
  /** 平台此刻支不支持弹系统通知。 */
  isSupported: () => boolean
  /** 真弹那一步。 */
  present: (shown: NotifyShown, onActivate: () => void) => void
}

/** 没接线时的默认：不支持、不弹。**不**默认成"支持"，否则没装配的环境会静默假装弹过了。 */
const UNWIRED: NotifyHost = { isSupported: () => false, present: () => undefined }

let host: NotifyHost = UNWIRED

/** 装配平台能力（ Electron 侧在 `registerIpcHandlers` 里调一次）。 */
export function configureNotifyHost(next: NotifyHost): void {
  host = next
}

/** 拆掉平台能力（单测收尾）。 */
export function resetNotifyHost(): void {
  host = UNWIRED
}

interface Batch {
  pending: NotifyPending
  /** 点击后要跳到哪个账号。与 pending 同批存，避免 flush 时再反查。 */
  accountId: number
}

const batches = new Map<string, Batch>()
const timers = new Map<string, NodeJS.Timeout>()

export type NotifyClickHandler = (target: { accountId: number; chatKey: string }) => void

let clickHandler: NotifyClickHandler | null = null

/**
 * 点击通知的落点由调用方（`ipc.ts`）决定：它知道主窗口与 `webContents.send`，
 * 这里不该反向依赖窗口模块。
 */
export function setNotifyClickHandler(handler: NotifyClickHandler | null): void {
  clickHandler = handler
}

/** 弹掉一个待弹批次。内部用：清定时器 → 取批 → 交给平台。 */
function flushChat(chatKey: string): NotifyShown | null {
  const timer = timers.get(chatKey)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(chatKey)
  }
  const batch = batches.get(chatKey)
  batches.delete(chatKey)
  if (!batch) return null
  const shown: NotifyShown = {
    chatKey,
    accountId: batch.accountId,
    title: notifyTitleOf(batch.pending),
    body: notifyBodyOf(batch.pending),
    count: batch.pending.count
  }
  host.present(shown, () => {
    clickHandler?.({ accountId: shown.accountId, chatKey: shown.chatKey })
  })
  return shown
}

/**
 * 一帧入站消息来了。
 *
 * `now` 显式入参是为了可测：合并窗口完全由时刻决定，靠 `Date.now()` 就只能在真的等 3 秒之后断言。
 */
export function showIncoming(req: NotifyShowRequest, now: number = Date.now()): NotifyVerdict {
  // 平台不支持就别排队：排了也弹不出来，还会让渲染层以为"排进去了"。
  if (!host.isSupported()) return { action: 'skip', reason: 'unsupported' }

  const decision = notifyDecisionOf(req)
  if (decision.action === 'skip') return decision

  const prev = batches.get(req.chatKey)?.pending ?? null
  const merged = mergeNotifyPending(
    prev,
    { chatKey: req.chatKey, title: req.title, body: req.body },
    now
  )
  batches.set(req.chatKey, { pending: merged, accountId: req.accountId })

  // 只对第一批起定时器。已经在窗口内的不再重起——每来一条就重起一次会把窗口无限延长，
  // 一个一直有人在说话的会话就永远弹不出通知。
  if (!timers.has(req.chatKey)) {
    const timer = setTimeout(() => {
      flushChat(req.chatKey)
    }, NOTIFY_MERGE_WINDOW_MS)
    timers.set(req.chatKey, timer)
  }

  return { action: 'queued', chatKey: req.chatKey, count: merged.count }
}

/** 立刻弹掉待弹批次（不带 chatKey = 全部）。退出登录前与单测断言用它。 */
export function flushNotify(chatKey?: string): NotifyShown[] {
  if (chatKey !== undefined) {
    const one = flushChat(chatKey)
    return one ? [one] : []
  }
  const out: NotifyShown[] = []
  for (const key of [...batches.keys()]) {
    const one = flushChat(key)
    if (one) out.push(one)
  }
  return out
}

/** 清掉待弹批次但**不弹**（退出登录、切账号）。与 `flushNotify` 的区别就是这个"不弹"。 */
export function resetNotifyState(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  batches.clear()
}

/** 此刻待弹的批次数。驱动断言"清干净了没有"用。 */
export function pendingNotifyCount(): number {
  return batches.size
}
