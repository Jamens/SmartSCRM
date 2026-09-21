// src/bridge/index.ts —— 本任务到此为止：握手 + 心跳应答 + 卸载
import { makeThrottledReporter, onCommand, report } from './host.ts'
import type { BridgeCommand, BridgeInstallConfig } from '../shared/chatTypes.ts'

let installed: BridgeInstallConfig | null = null
let offCommand: (() => void) | null = null
/** 装好后由 mount 调用；send / backfill / open_chat 的 case 在 Task 12 / 14 里补。 */
let handle: ((cmd: BridgeCommand) => void) | null = null

export function install(config: BridgeInstallConfig): boolean {
  if (installed && installed.bridgeVersion === config.bridgeVersion) return false
  destroy()
  installed = config
  const push = makeThrottledReporter()
  handle = (cmd: BridgeCommand): void => {
    if (cmd.kind === 'ping') push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
  }
  offCommand = onCommand((cmd) => handle?.(cmd))
  // 同步返回值给主进程：见 plan 注释——pong 在 ready 前，返回值 true 是最快的确认
  push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
  report({ kind: 'ready', bridgeVersion: config.bridgeVersion })
  return true
}

export function destroy(): void {
  offCommand?.()
  offCommand = null
  handle = null
  installed = null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__SCRM_BRIDGE_DESTROY__ = (): void => {
  destroy()
}
