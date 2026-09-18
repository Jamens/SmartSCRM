type OverlayListener = (open: boolean) => void

let openCount = 0
const listeners = new Set<OverlayListener>()

/**
 * 对话框这类 DOM 浮层永远在文档层内，而内嵌平台视图是主进程的原生层，画在所有 DOM 之上。
 * 浮层打开时必须让视图临时收起，否则用户看到的就是一块盖住对话框的空白。
 * 这里只负责「有没有浮层」的计数，收起与恢复由持有视图的 useWebContentsView 决定。
 */
export function subscribeOverlay(listener: OverlayListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function beginOverlay(): void {
  openCount += 1
  if (openCount === 1) for (const listener of listeners) listener(true)
}

export function endOverlay(): void {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) for (const listener of listeners) listener(false)
}
