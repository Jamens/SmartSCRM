import type { BridgeState, SendReceipt, SendRequest } from '@shared/chatTypes'

/**
 * 类型从 `preload/index.ts` 的 `ScrmApi = typeof scrm` 推出来：preload 多一个成员这里就自动有类型，
 * 不需要手写第二份接口。下面这份 `fallback` 因此没有 `as MsgApi` 断言——漏掉成员会直接报缺字段，
 * 逼着浏览器模式同步补齐（漏掉的后果是浏览器里点一下发送就 `is not a function`）。
 */
type MsgApi = NonNullable<Window['scrm']>['msg']

const noVal = <T>(v: T): (() => Promise<T>) => () => Promise.resolve(v)

/** 浏览器里没有内嵌视图：发送一律 BRIDGE_OFFLINE，比抛错更容易让 UI 保持离线态。 */
const fallback: MsgApi = {
  send: (req: SendRequest) =>
    Promise.resolve<SendReceipt>({
      localId: req.localId,
      ok: false,
      error: 'BRIDGE_OFFLINE',
      detail: '浏览器模式无消息桥'
    }),
  syncHistory: noVal(false),
  bridges: noVal<BridgeState[]>([]),
  onLive: () => () => {},
  onStatus: () => () => {},
  onState: () => () => {}
}

export const isElectron = typeof window !== 'undefined' && !!window.scrm

export const msgService: MsgApi & { isElectron: boolean } = {
  ...(window.scrm?.msg ?? fallback),
  isElectron
}
