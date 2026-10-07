// src/renderer/src/lib/planGuard.ts
// B12 模拟支付门控：超额判定（软阻断）。
// 「软阻断」= 只在前端提示，不阻断后端：超额时弹本地提示，用户选「仍要继续」照样放行，
// 也不在后端做硬校验。配额上限来自 /api/tenant/info（B12 用量模型）。
import type { TenantInfo } from '@/api/tenant'

export type PlanResource = 'seat' | 'aiToken' | 'translation'

export interface PlanUsage {
  seats: number
  aiTokens: number
  translation: number
}

/** 资源对应的文案键（复用 overview 下已有的资源名）。 */
export function planResourceLabelKey(resource: PlanResource): string {
  switch (resource) {
    case 'seat':
      return 'overview.seats'
    case 'aiToken':
      return 'overview.aiTokens'
    case 'translation':
      return 'overview.translationChars'
  }
}

/**
 * 判定某项资源是否已到上限。limit 为 null 表示「不限量」，此时永远不超额；
 * 租户信息还没取到时也不判定（拿不到数就不打扰用户）。
 */
export function isOverLimit(
  tenant: TenantInfo | undefined,
  usage: PlanUsage,
  resource: PlanResource
): boolean {
  if (!tenant) return false
  switch (resource) {
    case 'seat':
      return tenant.seatLimit != null && usage.seats >= tenant.seatLimit
    case 'aiToken':
      return tenant.aiTokenLimit != null && usage.aiTokens >= tenant.aiTokenLimit
    case 'translation':
      return tenant.translationCharLimit != null && usage.translation >= tenant.translationCharLimit
  }
}
