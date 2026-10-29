// src/main/services/fingerprint/applier.ts
import type { WebContents } from 'electron'
import { FP_TOGGLE_KEYS } from '../../../shared/fingerprint.ts'
import type { FingerprintRuntime, FpToggleKey } from '../../../shared/fingerprint.ts'

const DEBUGGER_PROTOCOL = '1.3'

/**
 * 引导装载（about:blank → dom-ready）的兜底上限。
 * 拿不到这一次装载就等于没有 target，后面每一条 CDP 命令都会永久挂住——所以要给上限，掉了就降级。
 */
const BOOTSTRAP_TIMEOUT_MS = 5000

/** 引导失败时的降级说明：只落到 `ApplyResult.error`，不做别的（尤其不做"晚一点再注入"，那违反 R4）。 */
const BOOTSTRAP_FAILED = 'CDP target 不可用：引导装载未完成'

export interface ApplyResult {
  applied: FpToggleKey[]
  skipped: FpToggleKey[]
  /** 任一步失败都只落在这里，并降级为"该项不施加"——绝不降级为 did-navigate 注入（那违反 R4）。 */
  error?: string
}

/**
 * 交给页内脚本的配置：已按 toggles 剔除被关掉的项。
 * 关掉 canvas 时配置里连 `canvasNoiseSeed` 都不出现——"配置里带着种子却不用"是隐患（R9 不留空跑）。
 * 缺的项同样不出现：页内脚本据此"该项不改"（R7）。
 * profileId 不下发：页内脚本用不到，能不给的就不给。
 */
function publicConfig(runtime: FingerprintRuntime): Record<string, unknown> {
  const on = (key: FpToggleKey): boolean => runtime.toggles[key] !== false
  const toggles: Partial<Record<FpToggleKey, boolean>> = {}
  for (const key of FP_TOGGLE_KEYS) toggles[key] = on(key)

  const cfg: Record<string, unknown> = { seed: runtime.seed, toggles }
  if (on('navigator')) {
    if (runtime.userAgent != null) cfg.userAgent = runtime.userAgent
    if (runtime.uaPlatform != null) cfg.uaPlatform = runtime.uaPlatform
    if (runtime.uaPlatformVersion != null) cfg.uaPlatformVersion = runtime.uaPlatformVersion
    if (runtime.brands != null) cfg.brands = runtime.brands
    if (runtime.locale != null) cfg.locale = runtime.locale
    if (runtime.hardwareConcurrency != null) cfg.hardwareConcurrency = runtime.hardwareConcurrency
    if (runtime.deviceMemory != null) cfg.deviceMemory = runtime.deviceMemory
  }
  if (on('canvas') && runtime.canvasNoiseSeed != null) cfg.canvasNoiseSeed = runtime.canvasNoiseSeed
  if (on('audio') && runtime.audioNoiseSeed != null) cfg.audioNoiseSeed = runtime.audioNoiseSeed
  if (on('webgl')) {
    if (runtime.webglVendor != null) cfg.webglVendor = runtime.webglVendor
    if (runtime.webglRenderer != null) cfg.webglRenderer = runtime.webglRenderer
  }
  if (on('timezone') && runtime.timezone != null) cfg.timezone = runtime.timezone
  return cfg
}

/** 纯函数：runtime + bundle 源码 → 文档前脚本全文。不碰 Electron，可单测。 */
export function buildFingerprintSource(runtime: FingerprintRuntime, bundle: string): string {
  return `(function(){window.__FP_CONFIG__=${JSON.stringify(publicConfig(runtime))};})();\n${bundle}`
}

/**
 * 让 CDP 真正可用：Chromium 的 target 要**有过一次已提交的装载**才存在。
 *
 * 实测（Electron 39 / Chromium 142，本机）：对一次都没导航过的 WebContentsView，
 * `debugger.attach()` 立刻成功、`isAttached()` 返回 true，但之后**任何**一条 CDP 命令都不返回
 * （30s 也不返回，连不到页渲染进程），连 `executeJavaScript` 也一起挂住——不是抛错，是永久挂住。
 * 所以第一次用到 CDP 之前，先自己导航一次 `about:blank` 并等它的 `dom-ready`。
 *
 * 只在这次 CDP 会话之前多这一次装载：**已经导航过**的视图（换绑后再施加，R3 的那条路）
 * 直接返回，不会把它当前装载的页面顶掉。`about:blank` 不来就返回 false，由调用方降级——
 * 绝不带着一个"看起来 attached"的假状态继续往下走（那会把整个装载流程挂死在 await 上）。
 */
async function ensureCdpTarget(wc: WebContents): Promise<boolean> {
  if (wc.getURL()) return true
  try {
    await new Promise<void>((resolve, reject) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => reject(new Error('引导装载超时')),
        BOOTSTRAP_TIMEOUT_MS
      )
      const done = (): void => {
        clearTimeout(timer)
        wc.removeListener('dom-ready', done)
        resolve()
      }
      wc.on('dom-ready', done)
      try {
        wc.loadURL('about:blank')
      } catch (e) {
        wc.removeListener('dom-ready', done)
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    return true
  } catch {
    return false
  }
}

/**
 * 把 runtime 施加到视图上（spec §2.1 时序）。
 *
 * runtime 为 null = 不施加任何指纹（R2 未绑定 / R9 全局关）：三个方法一个都不调用，不留空跑。
 * 每一步各自 try/catch：一步失败只让那一项不施加，其余照走。**绝不降级为 `did-navigate` 注入**——
 * 那等于写了个不知道有没有生效的东西，违反 R4。
 */
export async function applyFingerprint(
  wc: WebContents,
  runtime: FingerprintRuntime | null,
  bundle: string
): Promise<ApplyResult> {
  if (!runtime) return { applied: [], skipped: [...FP_TOGGLE_KEYS] }

  const on = (key: FpToggleKey): boolean => runtime.toggles[key] !== false
  const errors: string[] = []
  let uaApplied = false
  let tzApplied = false
  let scriptApplied = false

  // ① UA + Accept-Language：会话级，随首个请求头发出，无竞态（R5）。
  //    只在 UA 非空时调；locale 为空时只传第一个参数——传 undefined 会让 Electron 清掉 Accept-Language。
  if (runtime.userAgent && on('navigator')) {
    try {
      if (runtime.locale) wc.session.setUserAgent(runtime.userAgent, runtime.locale)
      else wc.session.setUserAgent(runtime.userAgent)
      uaApplied = true
    } catch (e) {
      errors.push(`UA 覆盖失败：${messageOf(e)}`)
    }
  }

  // ② 时区：只在这里为时区 attach；attach 之后**永不 detach**（R6——detach 会把时区重置回系统值）。
  //    文档前脚本同样走 CDP，所以 attach 是"任一 CDP 步骤需要就附一次"，而不是每步各附一次。
  const wantTz = !!runtime.timezone && on('timezone')
  const wantScript = !!bundle && FP_TOGGLE_KEYS.some(on)
  let attached = false
  // target 是否就绪整个施加过程只判一次：只需要多一次的装载，不是每一步各来一次。
  let targetReady: boolean | null = null
  const ensureAttached = async (): Promise<void> => {
    if (attached) return
    if (targetReady === null) targetReady = await ensureCdpTarget(wc)
    if (!targetReady) throw new Error(BOOTSTRAP_FAILED)
    if (!wc.debugger.isAttached?.()) await wc.debugger.attach(DEBUGGER_PROTOCOL)
    attached = true
  }

  if (wantTz) {
    try {
      await ensureAttached()
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: runtime.timezone })
      tzApplied = true
    } catch (e) {
      errors.push(`时区覆盖失败：${messageOf(e)}`)
    }
  }

  // ③ 文档前脚本：文档创建前注入 = 早于任何页面脚本（R4 的全部内容）。
  if (wantScript) {
    try {
      await ensureAttached()
      // Page 域必须先 enable：实测不发这一步时，addScriptToEvaluateOnNewDocument 回成功、
      // 脚本却一次都不执行——既不报错也不注入，调用方拿到的是"施加成功"（静默失效）。
      await wc.debugger.sendCommand('Page.enable')
      await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: buildFingerprintSource(runtime, bundle)
      })
      scriptApplied = true
    } catch (e) {
      errors.push(`文档前脚本注入失败：${messageOf(e)}`)
    }
  }

  const applied: FpToggleKey[] = []
  const skipped: FpToggleKey[] = []
  for (const key of FP_TOGGLE_KEYS) {
    const done = on(key) && (key === 'timezone' ? tzApplied : key === 'navigator' ? uaApplied || scriptApplied : scriptApplied)
    ;(done ? applied : skipped).push(key)
  }
  const result: ApplyResult = { applied, skipped }
  if (errors.length) {
    result.error = errors.join('；')
    console.warn(`[fingerprint] 部分未施加：${result.error}`)
  }
  return result
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
