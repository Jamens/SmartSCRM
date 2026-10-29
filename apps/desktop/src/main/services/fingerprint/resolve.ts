// src/main/services/fingerprint/resolve.ts
import { getSession } from '../../state/session'
import { getSettings } from '../../state/settings'
import { accountOfView, refreshAccounts } from '../msgBridge/accountDirectory'
import { createMsgApi } from '../msgBridge/msgApi'
import { resolveRuntime, type FingerprintProfileRow } from './runtime'
import type { FingerprintRuntime } from '../../../shared/fingerprint.ts'

const api = createMsgApi({ token: () => getSession()?.accessToken ?? null })

/**
 * 视图 → 账号 → 已解析指纹参数。返回 `null` = **这个视图不施加任何指纹**。
 *
 * 任一步拿不到就折 `null`（R2）：静默生效的指纹比没有指纹危险，宁可"压根没挂"。
 * 于是每一步都必须是"取不到就走"，没有一步能抛——`loadURL` 排在它之后，
 * 一抛就是"视图永远停在空白页"，而指纹是增强不是前提。
 */
export async function resolveRuntimeForView(viewId: string): Promise<FingerprintRuntime | null> {
  try {
    return await resolve(viewId)
  } catch (error) {
    console.warn(`[fingerprint] ${viewId} 解析失败，本轮不施加指纹（原因：${String(error)}）`)
    return null
  }
}

async function resolve(viewId: string): Promise<FingerprintRuntime | null> {
  const settings = getSettings()
  // 全局开关：用户没显式开启就到此为止，一个字节都不下发（R9 的"不留空跑"）。
  if (!settings.fingerprintEnabled) return null

  // 视图归属由主进程自己拉（带 5 分钟 TTL）：渲染层切路由之后登录才成功是常态。
  await refreshAccounts()
  const account = accountOfView(viewId)
  if (!account) return null

  // 后端未绑定时是 `code:0` + `data:null`，在 msgApi 里已折成 null，这里不再区分。
  // 刻意**不**用目录里的 `fingerprintProfileId` 提前短路：那份目录有 5 分钟 TTL，
  // 刚换绑的账号在 TTL 内读到的是旧值，短路就会把这次换绑吞掉（D5 要求换绑立即生效）。
  const profile = await api.fingerprintRuntime(account.accountId)
  if (!profile) return null

  return resolveRuntime(toProfileRow(profile), {
    enabled: settings.fingerprintEnabled,
    toggles: settings.fingerprintToggles
  })
}

/**
 * `FingerprintRuntime`（缺项 = 字段不存在）→ `FingerprintProfileRow`（缺项 = null）。
 * 两者是同一份后端 JSON 的两种读法：shared 里用可选表达"不改"，runtime.ts 里用 null 与后端对齐。
 * 这一层只做搬运，不补全任何值。
 */
function toProfileRow(r: FingerprintRuntime): FingerprintProfileRow {
  return {
    profileId: r.profileId,
    seed: r.seed,
    userAgent: r.userAgent ?? null,
    uaPlatform: r.uaPlatform ?? null,
    uaPlatformVersion: r.uaPlatformVersion ?? null,
    brands: r.brands ?? null,
    locale: r.locale ?? null,
    timezone: r.timezone ?? null,
    hardwareConcurrency: r.hardwareConcurrency ?? null,
    deviceMemory: r.deviceMemory ?? null,
    webglVendor: r.webglVendor ?? null,
    webglRenderer: r.webglRenderer ?? null,
    canvasNoiseSeed: r.canvasNoiseSeed ?? null,
    audioNoiseSeed: r.audioNoiseSeed ?? null
  }
}
