// src/main/services/msgBridge/bridgeMount.ts
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { app, type WebContents } from 'electron'
import type { BridgeCommand, BridgeInstallConfig, BridgeReport, BridgeState } from '@shared/chatTypes'

const READY_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 30_000
/** 连丢两次 pong 才算掉线：单次丢失很可能只是页面正在主线程做大重绘。 */
const MISS_LIMIT = 2
const MAX_BACKOFF_MS = 5 * 60_000

export interface Bundles {
  wa: string
  bridge: string
  /** wa-js 那份的内容哈希：换版本要允许重贴，否则升级 wa-js 后老页面永远不再装新 Store。 */
  waVersion: string
  /** 桥自身的内容哈希，就是 install() 收到的 bridgeVersion。 */
  version: string
}

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

let cached: { mtime: number; bundles: Bundles } | null = null

/** 版本号 = 内容哈希：不手填版本，就不会出现"改了代码忘了改版本号"。按 mtime 失效缓存。 */
export function bridgeBundles(): Bundles {
  const bridgePath = resourcePath('msg-bridge.bundle.js')
  const mtime = statSync(bridgePath).mtimeMs
  if (cached && cached.mtime === mtime) return cached.bundles
  const bridge = readFileSync(bridgePath, 'utf-8')
  const wa = readFileSync(resourcePath('wa-js.bundle.js'), 'utf-8')
  const bundles: Bundles = {
    wa,
    bridge,
    waVersion: createHash('sha1').update(wa).digest('hex').slice(0, 12),
    version: createHash('sha1').update(bridge).digest('hex').slice(0, 12)
  }
  cached = { mtime, bundles }
  return bundles
}

/**
 * 已装 wa-js 的 webContents → 装的是哪个版本。
 * 同一个页面重复执行 wa-js 会重建它自己的 Store，已挂的钩子集体指向旧 Store，
 * 现象就是"桥报 ready 但一条消息都收不到"——所以这里必须按 webContents 记一次。
 * 页面重新加载（导航 / reload）后旧 Store 已经没了，那一行必须清掉，见 Step 4。
 */
const waLoadedOn = new Map<number, string>()

export function forgetPageBundleCache(webContentsId: number): void {
  waLoadedOn.delete(webContentsId)
}

export interface MountOptions {
  viewId: string
  accountId: number
  platform: BridgeInstallConfig['platform']
  historyLimit: number
  webContents: WebContents
  onState: (state: BridgeState) => void
  /** 主 → 页的唯一下行出口，由 index 传 `viewManager.sendToView`。 */
  pushToView: (viewId: string, cmd: BridgeCommand) => void
}

/**
 * 一个视图一条桥（spec §4 第 1、2 条）：装 → 确认 → 养。
 * "养"这一段只看 pong：WhatsApp 页面热更新会让已装的钩子失效而脚本全局还在，
 * 所以 `window.__SCRM_BRIDGE_BUNDLE__` 存在不等于钩子还在。
 */
export class BridgeMount {
  private phase: BridgeState['phase'] = 'none'
  private since = Date.now()
  private detail: string | null = null
  private misses = 0
  private backoff = HEARTBEAT_MS
  private heartbeat: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null
  private confirmReady: (() => void) | null = null
  private stopped = false
  private readonly bundles: Bundles

  constructor(private readonly opts: MountOptions) {
    this.bundles = bridgeBundles()
  }

  get ready(): boolean {
    return this.phase === 'ready'
  }

  state(): BridgeState {
    return {
      viewId: this.opts.viewId,
      accountId: this.opts.accountId,
      platform: this.opts.platform,
      phase: this.phase,
      ready: this.phase === 'ready',
      since: this.since,
      detail: this.detail
    }
  }

  push(cmd: BridgeCommand): void {
    this.opts.pushToView(this.opts.viewId, cmd)
  }

  /**
   * 只消化生命周期三种上报，其余一律返回 false 让上层（`index.ts`）继续路由。
   * 不在这里回调上层：桥的 `handleBridgeReport` 又要经过 mount 才能到达，会把调用绕成环。
   */
  handle(report: BridgeReport): boolean {
    if (this.stopped) return true
    switch (report.kind) {
      case 'ready':
        this.confirmReady?.()
        return true
      case 'pong':
        this.onPong()
        return true
      case 'logged_out':
        this.stopTimers()
        this.setPhase('offline', '页面退出登录')
        return true
      default:
        return false
    }
  }

  async mount(): Promise<boolean> {
    if (this.stopped) return false
    this.setPhase('mounting')
    const wc = this.opts.webContents
    const confirmed = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)
      timer.unref()
      this.confirmReady = () => {
        clearTimeout(timer)
        resolve(true)
      }
    })
    const config: BridgeInstallConfig = {
      bridgeVersion: this.bundles.version,
      platform: this.opts.platform,
      viewId: this.opts.viewId,
      historyLimit: this.opts.historyLimit
    }
    try {
      if (waLoadedOn.get(wc.id) !== this.bundles.waVersion) {
        console.log(`[msgBridge] 注入 wa-js view=${this.opts.viewId} waVersion=${this.bundles.waVersion}`)
        await wc.executeJavaScript(this.bundles.wa)
        waLoadedOn.set(wc.id, this.bundles.waVersion)
      }
      console.log(`[msgBridge] 注入桥 view=${this.opts.viewId} bridgeVersion=${this.bundles.version}`)
      await wc.executeJavaScript(
        `${this.bundles.bridge}\n;window.__SCRM_BRIDGE_BUNDLE__ && window.__SCRM_BRIDGE_BUNDLE__.install(${JSON.stringify(config)});`
      )
    } catch (e) {
      this.confirmReady = null
      this.scheduleRetry(`注入失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    }
    const ok = await confirmed
    this.confirmReady = null
    if (!ok) {
      this.scheduleRetry('ready 握手超时')
      return false
    }
    this.misses = 0
    this.backoff = HEARTBEAT_MS
    this.setPhase('ready')
    this.startHeartbeat()
    return true
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopTimers()
    this.confirmReady?.()
    this.confirmReady = null
    waLoadedOn.delete(this.opts.webContents.id)
    this.setPhase('destroyed')
  }

  private onPong(): void {
    this.misses = 0
    if (this.phase === 'ready') return
    // 桥还活着（钩子没掉），只是主进程先前误判：把心跳续上即可，不重装。
    this.backoff = HEARTBEAT_MS
    this.setPhase('ready')
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (this.stopped) return
      if (this.opts.webContents.isDestroyed()) {
        this.scheduleRetry('视图已销毁')
        return
      }
      this.push({ kind: 'ping' })
      this.misses += 1
      if (this.misses >= MISS_LIMIT) this.scheduleRetry('心跳连续丢失')
    }, HEARTBEAT_MS)
    this.heartbeat.unref()
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return
    this.stopTimers()
    this.setPhase('retry', reason)
    const wait = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    this.retry = setTimeout(() => {
      void this.mount()
    }, wait)
    this.retry.unref()
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private stopTimers(): void {
    this.stopHeartbeat()
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  private setPhase(phase: BridgeState['phase'], detail: string | null = null): void {
    this.phase = phase
    this.since = Date.now()
    this.detail = detail
    // C3：生命周期日志只有 viewId 与阶段，消息正文永不入日志。
    console.log(`[msgBridge] phase=${phase} view=${this.opts.viewId}${detail ? ` detail=${detail}` : ''}`)
    this.opts.onState(this.state())
  }
}
