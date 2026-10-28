// src/fingerprint/tasks/iframe.ts
/**
 * 动态 iframe 覆盖：`MutationObserver` 盯着新增节点，是 iframe 就往它的 `contentWindow`
 * 里递归跑同一批 install（页面可以在任意时刻塞一个指纹采集 iframe 进来）。
 *
 * 跨域 iframe 是常态而不是异常：光是**读** `contentWindow` 就可能抛。所以取值与递归整体
 * 包在 try/catch 里一律吞掉——跨域装不上是预期结果，冒泡出去会打断同一批里的其它 hook。
 */
import type { FingerprintRuntime } from '../../shared/fingerprint.ts'
import type { FpContext } from '../types.ts'

type FrameInstaller = (win: Record<string, unknown>, cfg: Partial<FingerprintRuntime>) => void

let installer: FrameInstaller | null = null

/**
 * 由 index.ts 装配：iframe 里要跑的是"同一批 install"，而"这一批"只有组装层知道，
 * 让 task 反向 import index 会成环。
 */
export function setFrameInstaller(fn: FrameInstaller | null): void {
  installer = fn
}

/** 往一个子窗口里装同一批 hook。跨域失败静默吞掉。 */
export function installFrame(win: Record<string, unknown>, ctx: FpContext): void {
  if (!installer || !win) return
  try {
    installer(win, ctx.cfg)
  } catch {
    // 跨域：装到一半也会抛（读写子窗的原型）。这里不记、不报——页内脚本的失败模式就是"不生效"。
  }
}

export function install(ctx: FpContext): void {
  const doc = ctx.target
  if (typeof MutationObserver === 'undefined') return
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const nodes = r.addedNodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as unknown as {
          tagName?: string
          contentWindow?: Record<string, unknown>
        }
        if (node.tagName !== 'IFRAME') continue
        try {
          installFrame(node.contentWindow as Record<string, unknown>, ctx)
        } catch {
          // 跨域：读 contentWindow 这一步就抛。
        }
      }
    }
  })
  try {
    mo.observe(doc as unknown as Node, { childList: true, subtree: true })
  } catch {
    // 文档不可观测（沙箱 / 已分离）：这一项不生效即可。
  }
}
