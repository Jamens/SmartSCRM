// src/shared/degradeCopy.ts

/** 降级在页面上的三种形状。 */
export type DegradeShape = 'none' | 'retry' | 'dead'

/** 可重试那一格保持 #144 落地的原句：那颗按钮点得动，别在文案里预告厂商错误。 */
export const RETRY_LABEL = '翻译失败 · 点此重试'
/** 后端判了死路却没给原因时的兜底句（`degradeReason` 可空，读码 `TranslateVO`）。 */
export const DEAD_FALLBACK_LABEL = '翻译失败（重试无效）· 这条线路出不了译文'

/** 只取降级那三个字段：让注入层、消息态与单测能用同一个形状判据。 */
export interface DegradeFields {
  degraded?: boolean
  /** 后端 `TranslateVO.degradeRetryable`：false = 配置性死路（未配密钥 / 语种不支持）。 */
  degradeRetryable?: boolean
  degradeReason?: string | null
}

/**
 * 降级要分两种形状说话，因为它们的"下一步"根本不同：厂商 HTTP 5xx / 断网是瞬时故障，点一次可能就好；
 * 未配置密钥与语种不在这条线路的表上是配置性死路，那颗「点此重试」点一万次也不会亮。
 * 分岔的证人只有一个字段——后端的 `degradeRetryable`（由抛出点 `ProviderException.retryable()` 带上来），
 * 所以这里绝不按 `degradeReason` 的文案猜：那是给人看的一句话，不是判据。
 *
 * 为什么住在 `shared` 而不是 `inject`：`test:unit` 的 glob 收 `src/shared/**`，收不到 `src/inject/**`，
 * 放这儿这个"给不给重试入口"的决定才有单测闸门。
 */
export function degradeCopy(result: DegradeFields | null | undefined): {
  shape: DegradeShape
  label: string
} {
  if (!result || result.degraded !== true) return { shape: 'none', label: '' }
  // 缺字段 ≠ 死路：只有后端明确说 false 才收掉重试入口，否则旧一份后端的降级会集体丢掉那颗按钮。
  if (result.degradeRetryable !== false) return { shape: 'retry', label: RETRY_LABEL }
  const reason = (result.degradeReason ?? '').trim()
  return { shape: 'dead', label: reason ? `翻译失败（重试无效）· ${reason}` : DEAD_FALLBACK_LABEL }
}
