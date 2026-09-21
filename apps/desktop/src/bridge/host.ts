// src/bridge/host.ts
import type { BridgeCommand, BridgeReport } from '../shared/chatTypes.ts'

/** 页 → 主 的唯一上行通道名；主 → 页 的唯一下行通道名。Task 10 的白名单认这两个。 */
export const REPORT_CHANNEL = 'msg-report'
export const COMMAND_CHANNEL = 'msg-cmd'

/** 由 `preload/view.ts` 暴露。桥脚本零凭据、零 HTTP（C2），所以只需要这一个入口。 */
interface EleBridge {
  sendToHost: (channel: string, data?: unknown) => void
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    ele?: EleBridge
  }
}

function ele(): EleBridge | null {
  return typeof window !== 'undefined' && window.ele ? window.ele : null
}

type Sink = (channel: string, data: unknown) => void

/**
 * 上行出口可替换：默认走 `window.ele`。
 * `node --test` 里没有 window，也没有 IPC——不注入就只能看着 report() 静默丢弃，
 * "哪些帧被合了、哪些没合"就永远测不到。生产路径不 set 它，行为与直接 sendToHost 完全一致。
 */
let sink: Sink | null = null

export function setSink(next: Sink | null): void {
  sink = next
}

export function report(r: BridgeReport): void {
  if (sink) sink(REPORT_CHANNEL, r)
  else ele()?.sendToHost(REPORT_CHANNEL, r)
}

/** 背压：live 帧在补底期间可能成百上千，按 kind 合帧上报，避免打爆 IPC。 */
export function makeThrottledReporter(intervalMs = 200): (r: BridgeReport) => void {
  const latest = new Map<string, BridgeReport>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const drain = (): void => {
    timer = null
    for (const r of latest.values()) report(r)
    latest.clear()
  }
  return (r: BridgeReport): void => {
    // 只有"同 kind 的进度类"可合帧；message / send_result 每条都要真上报。
    if (r.kind === 'backfill_progress') {
      latest.set(r.kind, r)
      if (!timer) timer = setTimeout(drain, intervalMs)
      return
    }
    report(r)
  }
}

export function onCommand(cb: (c: BridgeCommand) => void): () => void {
  const bridge = ele()
  if (!bridge) return () => undefined
  return bridge.on(COMMAND_CHANNEL, (payload) => {
    if (payload && typeof payload === 'object' && 'kind' in payload) cb(payload as BridgeCommand)
  })
}
