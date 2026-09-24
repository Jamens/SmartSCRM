/**
 * 任务栏未读角标的纯规则。放 shared 是因为它跨两个进程：渲染层按它算出该报几，
 * 主进程按同一套口径把 IPC 传进来的未知值钳成可显示的整数。
 */

export interface BadgeTarget {
  /** 设置里的「任务栏未读角标」开关。 */
  enabled: boolean
  /** 应用窗口此刻有没有焦点。 */
  focused: boolean
  /** 后端给的租户级未读总数；还没取到过就是 null。 */
  total: number | null
}

/**
 * 该往任务栏报多少。
 *
 * 聚焦时报 0 是刻意的：用户正在看这个应用，未读正在被读掉，任务栏上再挂一个数就是谎报；
 * 而且读会话会清未读，报上去的数下一秒就过期。失焦（切去别的软件、最小化）才是角标该出场的时刻。
 */
export function badgeCountOf(target: BadgeTarget): number {
  if (!target.enabled || target.focused) return 0
  return sanitizeBadgeCount(target.total)
}

/**
 * IPC 边界上的钳制：来路是渲染层，运行时形状不作保证，所以非有限数、负数、小数一律收敛，
 * 只交给 Electron 一个能显示的整数。`null`（还没取到数）按 0 处理，与 `badgeCountOf` 同一口径。
 */
export function sanitizeBadgeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** 角标动作的回执：谁真的被设了、用的图标多大。驱动按它判定，不靠"看起来没报错"。 */
export interface BadgeEcho {
  platform: string
  /**
   * `app.setBadgeCount` 的返回值。macOS/Linux 上 true 就是数字画出来了；
   * Windows 实测（Electron 39.8.10 / Win11）**也返回 true，但那里画不出数字**——
   * 所以这一位只证明"调用被平台接受"，Windows 的可见角标看 `overlayApplied`。
   */
  badgeApplied: boolean
  /** 本次是否真的动了 Windows 的任务栏 overlay（只有 win32 可能 true）。 */
  overlayApplied: boolean
  /** 红点图标的实际尺寸；资源加载失败时为 null，此时 overlay 一定没设上。 */
  imageSize: { width: number; height: number } | null
  /** 最终生效的计数（已钳制）。 */
  count: number
}
