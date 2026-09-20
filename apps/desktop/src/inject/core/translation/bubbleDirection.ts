/** 气泡归属判据里的公共算术：平台 DOM 只负责量出数值，判定规则集中在这里。 */

/** 左右留空至少要差这么多像素才认方向；差距更小说明气泡几乎铺满整行，方向不可判。 */
export const MIN_SIDE_GAP_DIFF = 24

export type BubbleSide = 'out' | 'in'

/**
 * 靠哪一侧就是谁发的：发出气泡贴右缘、收到气泡贴左缘，另一侧留出大片空白。
 * 留空差值不足 `MIN_SIDE_GAP_DIFF` 时返回 null，交给调用方兜底，不猜。
 */
export function sideFromGaps(leftGap: number, rightGap: number): BubbleSide | null {
  if (!Number.isFinite(leftGap) || !Number.isFinite(rightGap)) return null
  if (rightGap + MIN_SIDE_GAP_DIFF <= leftGap) return 'out'
  if (leftGap + MIN_SIDE_GAP_DIFF <= rightGap) return 'in'
  return null
}

/**
 * 译文与原文一致时不占一行（R7：`from == to` 直接返回原文）。
 * 这类气泡本来就无需翻译，再挂一行同字只会让人误判成「翻译坏了」。
 */
export function isNoopTranslation(text: string, translation: string): boolean {
  return text.trim() === translation.trim()
}
