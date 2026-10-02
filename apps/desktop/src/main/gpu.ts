import { app } from 'electron'
import { GPU_DEGRADED_FLAG, nextRelaunchArgs, resolveDesiredDegraded } from '@shared/gpu'
import { getMainWindow, getQuitting } from './window/mainWindow'
import { getSettings, patchSettings } from './state/settings'

/**
 * GPU 图形降级的主进程这一段。
 *
 * 三个关注点：
 * 1. 启动越早越好关掉 GPU —— `disable-gpu` 必须在 `app.ready` 之前落到 `commandLine`，
 *    所以 `applyGpuLaunchMode` 在模块顶层（whenReady 之前）就调用。
 * 2. 崩溃检测 —— GPU 子进程没了（Electron 39 走 `child-process-gone`，`gpu-process-crashed`
 *    已废弃）就判定为崩溃；标准态崩溃 → 记 `gpuSafeMode` 并带降级参数重启，降级态仍崩 →
 *    不再重启（否则死循环），改推 `gpu:fatal` 让渲染层提示排查驱动。
 * 3. 重启由主进程统一做（`relaunchGpu`）——渲染层只负责把"用户想要的模式"存进设置并请求重启，
 *    真正杀进程、带参重启的活儿在这里，避免渲染层直接碰 `app`。
 */

/** 本次进程是否带着降级参数启动。 */
export function launchedDegraded(): boolean {
  return process.argv.includes(GPU_DEGRADED_FLAG)
}

/**
 * 模块顶层调用：若本次就该降级（带着 flag 启动），立刻把 GPU 关掉。
 * 不读设置文件 —— 读盘要等 `app.ready`，那时再 appendSwitch 已经晚了。
 * 是否"该降级"在 whenReady 里用 `resolveDesiredDegraded` 重新算，这里只认启动参数。
 */
export function applyGpuLaunchMode(): boolean {
  const degraded = launchedDegraded()
  if (degraded) {
    app.commandLine.appendSwitch('disable-gpu')
  }
  return degraded
}

let relaunching = false

/**
 * 带指定降级态重启本应用。只会真正执行一次（崩溃事件可能连发）。
 * `desiredDegraded=true` 带 `--gpu-safe-mode` 重启（软件渲染）；`false` 清掉它（标准模式）。
 */
export function relaunchGpu(desiredDegraded: boolean): void {
  if (relaunching) return
  relaunching = true
  const args = nextRelaunchArgs(process.argv.slice(1), desiredDegraded)
  app.relaunch({ args })
  app.exit(0)
}

/**
 * 注册 GPU 崩溃处理器。在 whenReady 之后调用即可（崩溃只会发生在运行期）。
 *
 * 关键边界：降级模式本身仍崩溃时**绝不重启**——否则会卡在"崩→重启→崩"的死循环里，
 * 用户连设置页都进不去。这时只把诊断信息推给渲染层。
 */
export function registerGpuCrashHandler(): void {
  app.on('child-process-gone', (_event, details) => {
    // `details.type` 是 Electron 的 ProcessType 字面量（大小写在版本间有差异，这里大小写不敏感比较）。
    if (details?.type?.toLowerCase() !== 'gpu') return
    // 正在退出或已经决定重启：都不该再动。
    if (relaunching || getQuitting()) return
    if (launchedDegraded()) {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('gpu:fatal', {
          reason: details.reason ?? 'unknown',
          exitCode: details.exitCode ?? null
        })
      }
      return
    }
    // 标准态崩溃：把"下次默认进降级"落盘，再带降级参数重启一次。
    patchSettings({ gpuSafeMode: true })
    relaunchGpu(true)
  })
}

/**
 * whenReady 内、建窗之前调用：若设置表明本应降级但本次没带 flag（例如设置被改但进程还没重启），
 * 补一次带参重启。返回 true 表示已经重启、调用方应当就此返回不再建窗。
 */
export function ensureGpuModeBeforeWindow(): boolean {
  if (launchedDegraded()) return false
  const s = getSettings()
  const want = resolveDesiredDegraded({
    hardwareAcceleration: s.hardwareAcceleration,
    gpuSafeMode: s.gpuSafeMode,
    launchedDegraded: false
  })
  if (want) {
    relaunchGpu(true)
    return true
  }
  return false
}
