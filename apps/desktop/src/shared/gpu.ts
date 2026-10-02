/**
 * GPU 图形降级相关的纯规则。主进程与渲染层共用，本身不碰 electron（要单测）。
 *
 * 两套输入要分开想清楚：
 * - `hardwareAcceleration`：用户偏好（默认开）。关 = 用户想要软件渲染。
 * - `gpuSafeMode`：运行时状态（默认关）。true = 上次因 GPU 进程崩溃被自动降级，
 *   下次启动默认进降级，直到用户在设置页「重试标准模式」清掉它。
 * - `launchedDegraded`：本次进程是否带着 `--gpu-safe-mode` 启动（由崩溃处理器自动带上的重启参数）。
 */

/** 降级模式启动参数。主进程在崩溃重启时带上它，渲染/崩溃处理器据此识别「已经在降级态」。 */
export const GPU_DEGRADED_FLAG = '--gpu-safe-mode'

/** 降级模式下 GPU 仍崩溃时主进程推给渲染层的诊断信息。 */
export interface GpuFatalInfo {
  /** 子进程退出原因（`crashed` / `killed` / `oom` / `launch-failed` 等）。 */
  reason: string
  /** 退出码，可能为 null（部分平台拿不到）。 */
  exitCode: number | null
}

/** 启动时「本进程是否应当软件渲染」的判定。三个来源任一为真即降级。 */
export function resolveDesiredDegraded(o: {
  hardwareAcceleration: boolean
  gpuSafeMode: boolean
  launchedDegraded: boolean
}): boolean {
  return o.launchedDegraded || !o.hardwareAcceleration || o.gpuSafeMode
}

/**
 * 计算「下一个启动进程」的命令行参数。
 * 传入的 `argv` 应是 `process.argv.slice(1)`（不含 electron 可执行文件本身）。
 * 先把已有的降级 flag 抹掉，再按目标态决定加不加——避免重复叠加。
 */
export function nextRelaunchArgs(argv: string[], desiredDegraded: boolean): string[] {
  const base = argv.filter((a) => a !== GPU_DEGRADED_FLAG && !a.startsWith(`${GPU_DEGRADED_FLAG}=`))
  return desiredDegraded ? [...base, GPU_DEGRADED_FLAG] : base
}
