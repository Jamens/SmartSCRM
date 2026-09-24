import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { sanitizeBadgeCount, type BadgeEcho } from '@shared/badge'
import badgeDotPath from '../../../resources/badge-dot.png?asset'

/**
 * 任务栏未读角标。
 *
 * 两个平台各有一套 API，而且互不覆盖：
 * - mac/Linux：`app.setBadgeCount(n)` 画**数字**。
 * - Windows：`win.setOverlayIcon(image, description)` 在应用图标右下角贴一张 16×16 的**红点**，
 *   它不渲染文字，所以这里必须有一张真实的位图资源。
 * 于是同一份计数在两个平台上长成两种样子，这是平台的限制而不是设计上的不一致。
 *
 * Windows 上 `setBadgeCount` 也照样调：实测它返回 true，但任务栏上画不出数字，
 * 真正让人看见的是那条 overlay。回执里两位各自如实报，不拿一位去替另一位作证。
 */

let dot: NativeImage | null | undefined

/**
 * 红点只在第一次用时解一遍。坏资源不能把整条通知链带走，但也必须留一行指得到具体文件的日志——
 * 否则表现就是"Windows 上角标死活不出来，而任何地方都不报错"。
 */
function overlayIcon(): NativeImage | null {
  if (dot !== undefined) return dot
  const img = nativeImage.createFromPath(badgeDotPath)
  const { width, height } = img.getSize()
  const usable = !img.isEmpty() && width === 16 && height === 16
  dot = usable ? img : null
  if (!usable) {
    console.warn(
      `[badge] 角标红点不可用：${badgeDotPath}（empty=${img.isEmpty()} size=${width}x${height}，期望 16x16）` +
        ' —— Windows 端将没有角标'
    )
  }
  return dot
}

/**
 * 把计数推到任务栏，并如实回报每一路的结果。
 *
 * `raw` 按未知对待：这是 IPC 入口，渲染层给什么形状类型都不作运行时保证，
 * 钳制在 `sanitizeBadgeCount` 里做（同一份规则也用于渲染层自己算数）。
 */
export function setUnreadBadge(win: BrowserWindow | null, raw: unknown): BadgeEcho {
  const count = sanitizeBadgeCount(raw)

  let badgeApplied = false
  try {
    // 每平台都调一次并如实回报：`badgeApplied=false` 只可能是"调了但系统没接"（Windows 实测为 true），
    // 而它在 Windows 上为 true 也不代表画出了数字——那位读者的证据是 `overlayApplied`。
    badgeApplied = app.setBadgeCount(count)
  } catch (error) {
    console.warn(`[badge] setBadgeCount 抛错（原因：${String(error)}）`)
  }

  let overlayApplied = false
  if (process.platform === 'win32') {
    if (win && !win.isDestroyed()) {
      const icon = count > 0 ? overlayIcon() : null
      try {
        // 清掉也要调一次：不传 null 的话红点会一直挂在图标上，哪怕未读早就归零。
        win.setOverlayIcon(count > 0 ? icon : null, count > 0 ? `${count} 条未读消息` : '')
        // 归零这一支只要调用没抛就算做到了；非零这一支还要求资源本身可用。
        overlayApplied = count > 0 ? icon !== null : true
      } catch (error) {
        console.warn(`[badge] setOverlayIcon 抛错（原因：${String(error)}）`)
      }
    }
  }

  const image = overlayIcon()
  return {
    platform: process.platform,
    badgeApplied,
    overlayApplied,
    imageSize: image ? image.getSize() : null,
    count
  }
}
