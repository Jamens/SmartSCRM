import { WebContentsView, shell, BrowserWindow, app, type Rectangle } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { getMainWindow } from '../window/mainWindow'
import { chromeUserAgent } from './chromeUserAgent'
import { forgetPageBundleCache } from '../services/msgBridge/bridgeMount'
import { unmountView } from '../services/msgBridge'
import { assertViewUrlAllowed } from './allowedViewUrls'
import { resolveRuntimeForView } from '../services/fingerprint/resolve'
import { applyFingerprint } from '../services/fingerprint/applier'
import { fingerprintBundle } from '../services/fingerprint/bundle'

interface ManagedView {
  view: WebContentsView
  url: string
  host: string
  visible: boolean
  /** 导入的会话凭据（localStorage JSON 原文）；非空时在 dom-ready 注入 partition 后重载一次。 */
  seedCredential: string | null
  /** 凭据注入标记：只在每次视图生命周期内注入一次，避免 dom-ready（重载会再触发）无限循环。 */
  seeded: boolean
  /**
   * 首次 `loadURL` 是否已发出。指纹解析把装载推迟到了建视图之后（D3），
   * 在这段空窗里 webContents 还在 about:blank、`isLoading()` 是 false，
   * `inject()` 会据此立刻跑一遍 inject.bundle.js 打到空白文档上。用它把空窗标出来。
   */
  pendingLoad: boolean
}

interface InjectEntry {
  channel: string
  config: Record<string, unknown>
  injected: boolean
}

const HIDDEN: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

/** Origins that a platform page may legitimately navigate through during login. */
const SHARED_LOGIN_HOSTS = new Set([
  'accounts.google.com',
  'graph.facebook.com',
  'www.facebook.com',
  'appleid.apple.com',
  'api.telegram.org',
  'oauth.telegram.org'
])

function rootHost(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length <= 2 ? hostname : parts.slice(-3).join('.')
}

export class WebContentsViewManager {
  private views = new Map<string, ManagedView>()
  private activeViewId: string | null = null
  private injects = new Map<string, InjectEntry>()
  private wcToView = new Map<number, string>()
  private readonly viewPreloadPath = join(__dirname, '../preload/view.js')

  private hostWindow(): BrowserWindow | null {
    return getMainWindow()
  }

  createView(viewId: string, url: string, seedCredential?: string): boolean {
    const existed = this.views.has(viewId)
    if (existed) {
      const managed = this.views.get(viewId)!
      // 凭据可能在视图已存在后才导入：刷新一次待注入的凭据；若页面已就绪则立即注入并重载。
      if (seedCredential) managed.seedCredential = seedCredential
      this.showView(viewId)
      if (seedCredential && !managed.seeded) void this.maybeSeed(viewId)
      return false
    }
    const win = this.hostWindow()
    if (!win) throw new Error('主窗口尚未就绪')

    const partition = `persist:scrm-${viewId}`
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.viewPreloadPath
      }
    })

    this.wcToView.set(view.webContents.id, viewId)
    // 先定好浏览器身份再加载：页面第一次读 UA 就在这之后，晚一步就会被按 Electron 拒绝。
    const userAgent = chromeUserAgent()
    if (userAgent) view.webContents.setUserAgent(userAgent)

    try {
      const host = new URL(url).hostname
      this.attachNavigationGuard(view, host)
    } catch {
      /* invalid url surfaces on loadURL below */
    }

    view.webContents.on('dom-ready', () => {
      // pendingLoad 期间的那次 dom-ready 属于指纹引导装载（applier 为了拿到 CDP target 自己
      // 导航的 about:blank，见 services/fingerprint/applier.ts 的 ensureCdpTarget）。
      // 那是个空文档：凭据写不进去（localStorage 没有可用源），inject 打上去也随文档一起消失。
      // 放它过去的话 maybeSeed 会把 seeded 标成已注入并 reload，真正的首屏反而再也不注入凭据。
      if (this.views.get(viewId)?.pendingLoad) return
      // 顶层文档每次装载都会重新走一遍 dom-ready：旧页面的 wa-js Store 已经随文档一起没了，
      // 不清掉"已装 wa-js"记录，msgBridge 重挂时会跳过 wa 段，桥对着不存在的 Store 采不到东西。
      // （实测 Electron 39 的 WebContentsView 上 did-navigate 对 reload 不触发，dom-ready 才是可靠信号。）
      forgetPageBundleCache(view.webContents.id)
      // 先注入凭据：localStorage 写好并 reload 后，下一轮 dom-ready 里 seeded 已为 true，
      // 不会再重复注入；若本次不需注入（无凭据 / 已注入过），则直接走下面的 runInject。
      void this.maybeSeed(viewId)
      void this.runInject(viewId)
    })

    win.contentView.addChildView(view)
    view.setBounds(HIDDEN)
    view.setVisible(false)

    this.views.set(viewId, {
      view,
      url,
      host: safeHost(url),
      visible: false,
      seedCredential: seedCredential ?? null,
      seeded: false,
      pendingLoad: true
    })
    // 建视图前过白名单：渲染层一旦被 XSS 攻破，这里是拦住「把官方视图导航到钓鱼页」
    // 的最后一道。不要因为「调用方是主进程自己」就跳过——preload 把它暴露给了渲染层。
    assertViewUrlAllowed(url)
    // 加载**不再同步发生**：指纹解析要读后端，而 UA / Accept-Language / 时区 / 文档前脚本
    // 必须在首个请求发出之前就设好（R5 / R4）。所以先建视图、后异步解析、解析完再 loadURL。
    void this.loadWithFingerprint(viewId, url)
    // 新视图的缩放要立刻对齐主窗口，否则第一帧会按默认 1.0 渲染，和已开着的视图比例不一致。
    this.syncZoomToWindow()
    this.emit(viewId, 'created', url)
    return true
  }

  /**
   * B14：解析指纹 → 施加 → 才 loadURL（计划 D3）。
   *
   * 解析是异步的（要读后端），而 UA / 时区 / 文档前脚本必须在首个请求之前设好——
   * 同步 loadURL 满足不了，所以顺序只能是"建视图时不动，装载时先补身份再发第一个请求"。
   * `resolveRuntimeForView` 任一步取不到就返回 null，此时这里退化为与改动前完全一致的
   * 一次 `loadURL`（R2：未绑定 / 开关关 = 不施加任何指纹）。
   *
   * 两处 `views` 复查不是冗余：等待期间用户可以关掉账号，而对着已 `close()` 的 webContents
   * 调 CDP / loadURL 会抛 `Object has been destroyed`——那会把一个正常的关闭动作变成未捕获异常。
   *
   * 顺序上仍然是"先施加、后首次 loadURL"（D3）：`applyFingerprint` 里为了让 CDP 拿到 target
   * 会先自己导航一次 `about:blank`（从未导航过的视图上没有 target，见 applier.ts），
   * 那是空的一声不吭的装载，不经过本节目的页面脚本，等这一步走完才发真正的第一个请求。
   */
  private async loadWithFingerprint(viewId: string, url: string): Promise<void> {
    const runtime = await resolveRuntimeForView(viewId)
    const managed = this.views.get(viewId)
    if (!managed) return // 等待期间视图被销毁
    if (runtime) {
      const bundle = fingerprintBundle()
      if (bundle) await applyFingerprint(managed.view.webContents, runtime, bundle.source)
      if (!this.views.has(viewId)) return // 施加期间又被销毁
    }
    try {
      managed.pendingLoad = false
      managed.view.webContents.loadURL(url)
    } catch {
      /* 视图已失效：关掉账号与装载撞在同一帧时，这次装载就该无声放弃 */
    }
  }

  /**
   * B29 会话凭据注入：把导出的 localStorage JSON 写进视图的持久化 partition（与页面同源），
   * 再 reload 一次让平台脚本读到已登录态。只在首次 dom-ready 跑一次（seeded 守卫），避免
   * reload 触发的下一轮 dom-ready 无限循环。凭据非法 / 为空则标 seeded 跳过，不再重试。
   */
  private async maybeSeed(viewId: string): Promise<void> {
    const managed = this.views.get(viewId)
    if (!managed || managed.seeded || !managed.seedCredential) return
    try {
      const parsed = JSON.parse(managed.seedCredential)
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length > 0
      ) {
        const code =
          '(function(){var s=' +
          JSON.stringify(parsed) +
          ';for(var k in s){try{localStorage.setItem(k,String(s[k]));}catch(e){}}})();'
        await managed.view.webContents.executeJavaScript(code, true)
        managed.seeded = true
        managed.view.webContents.reload()
        return
      }
    } catch {
      /* 凭据格式损坏：标记已处理，避免反复重试 */
    }
    managed.seeded = true
  }

  showView(viewId: string): void {
    const target = this.views.get(viewId)
    if (!target) return
    for (const [id, managed] of this.views) {
      if (id !== viewId && managed.visible) {
        managed.visible = false
        managed.view.setVisible(false)
        managed.view.setBounds(HIDDEN)
      }
    }
    target.visible = true
    target.view.setVisible(true)
    this.hostWindow()?.contentView.addChildView(target.view)
    this.activeViewId = viewId
  }

  setBounds(viewId: string, rect: Rectangle): void {
    const managed = this.views.get(viewId)
    if (!managed || !managed.visible) return
    managed.view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    })
  }

  reload(viewId: string): void {
    this.views.get(viewId)?.view.webContents.reload()
  }

  /**
   * 把所有内嵌视图的缩放比对齐到主窗口。内嵌页（WhatsApp Web 等）默认各走各的缩放，
   * 主窗口因为系统 DPI / 用户缩放变了之后，视图不跟着变就会比主界面要么偏大要么偏小。
   * 主窗口自身的 `getZoomFactor` 已经把系统缩放折算进去了，直接复用它即可。
   *
   * 由主进程统一推：渲染层每个组件各自设会窜值，且视图在路由切换 / 热更新时可能被重建。
   */
  syncZoomToWindow(): void {
    const win = this.hostWindow()
    if (!win || win.isDestroyed()) return
    const factor = win.webContents.getZoomFactor()
    for (const managed of this.views.values()) {
      try {
        managed.view.webContents.setZoomFactor(factor)
      } catch {
        // 视图可能正在卸载（webContents 已失效），忽略即可——它的缩放下个生命周期会重新对齐。
      }
    }
  }

  navigate(viewId: string, url: string): void {
    const managed = this.views.get(viewId)
    if (managed) {
      // 导航前重新过白名单：视图里的第三方页面可能自己跳转到别的域
      assertViewUrlAllowed(url)
      managed.url = url
      managed.host = safeHost(url)
      managed.view.webContents.loadURL(url)
    }
  }

  async executeJS<T>(viewId: string, code: string): Promise<T> {
    const managed = this.views.get(viewId)
    if (!managed) throw new Error(`view ${viewId} not found`)
    return managed.view.webContents.executeJavaScript(code, true) as Promise<T>
  }

  hideAll(): void {
    for (const managed of this.views.values()) {
      managed.visible = false
      managed.view.setVisible(false)
      managed.view.setBounds(HIDDEN)
    }
    this.activeViewId = null
  }

  destroyView(viewId: string): void {
    const managed = this.views.get(viewId)
    if (!managed) return
    const win = this.hostWindow()
    // 宿主窗口可能已经先没了（退出时序里窗口比视图早拆）——那时读 `win.contentView` 直接抛
    // 「Object has been destroyed」，而拆账与关页面这两步跟窗口死活无关，必须照旧跑完。
    if (win && !win.isDestroyed()) win.contentView.removeChildView(managed.view)
    this.wcToView.delete(managed.view.webContents.id)
    this.injects.delete(viewId)
    unmountView(viewId)
    forgetPageBundleCache(managed.view.webContents.id)
    managed.view.webContents.close()
    this.views.delete(viewId)
    if (this.activeViewId === viewId) this.activeViewId = null
    this.emit(viewId, 'destroyed', managed.url)
  }

  // ============ Injection ============

  getViewIdByWebContents(webContentsId: number): string | undefined {
    return this.wcToView.get(webContentsId)
  }

  /** 只读出口：msgBridge 需要按 viewId 拿到 WebContents 才能 executeJavaScript。 */
  webContentsOf(viewId: string): Electron.WebContents | null {
    return this.views.get(viewId)?.view.webContents ?? null
  }

  /** Register (or update) the inject intent for a view and inject immediately if the page is ready. */
  inject(viewId: string, channel: string, config: Record<string, unknown>): void {
    const managed = this.views.get(viewId)
    if (!managed) return
    this.injects.set(viewId, { channel, config, injected: false })
    if (!managed.pendingLoad && !managed.view.webContents.isLoading()) void this.runInject(viewId)
  }

  uninject(viewId: string): void {
    const managed = this.views.get(viewId)
    const entry = this.injects.get(viewId)
    if (!managed || !entry) return
    entry.injected = false
    this.injects.delete(viewId)
    void managed.view.webContents
      .executeJavaScript('window.__SCRM_DESTROY__ && window.__SCRM_DESTROY__(); true', true)
      .catch(() => undefined)
  }

  /** Push to an embedded page; `preload/view.ts` exposes these as `window.ele.on(channel, cb)`. */
  sendToView(viewId: string, channel: string, payload: unknown): boolean {
    const managed = this.views.get(viewId)
    if (!managed) return false
    managed.view.webContents.send(`view:host:${channel}`, payload)
    return true
  }

  getInjectConfig(viewId: string): Record<string, unknown> | undefined {
    return this.injects.get(viewId)?.config
  }

  private async runInject(viewId: string): Promise<void> {
    const entry = this.injects.get(viewId)
    const managed = this.views.get(viewId)
    if (!entry || !managed) return
    const source = readInjectBundle()
    if (!source) {
      console.warn('[inject] inject.bundle.js 未找到，跳过注入')
      return
    }
    const call = `\n;window.__SCRM_INJECT__ && window.__SCRM_INJECT__(${JSON.stringify(
      entry.channel
    )}, ${JSON.stringify(entry.config)});`
    try {
      await managed.view.webContents.executeJavaScript(source + call, true)
      entry.injected = true
    } catch (e) {
      console.error(`[inject] ${viewId} 注入失败`, e)
    }
  }

  getOpenIds(): string[] {
    return [...this.views.keys()]
  }

  getActiveId(): string | null {
    return this.activeViewId
  }

  destroyAll(): void {
    for (const viewId of [...this.views.keys()]) this.destroyView(viewId)
  }

  private attachNavigationGuard(view: WebContentsView, host: string): void {
    const wc = view.webContents
    const root = rootHost(host)

    wc.setWindowOpenHandler(({ url }) => {
      // 只把 https 交给系统浏览器。放行 http 会让中间人可改写目标页；
      // javascript:/file: 交给 openExternal 则是把任意协议交给了操作系统。
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    wc.on('will-navigate', (event, url) => {
      // 非 http(s) 直接拦：javascript:/data:/file: 都不该在受管视图里导航。
      // 这里收严到 https ——原来 `/^https?:/` 放行了明文 http，那条路可被中间人改写。
      if (!/^https:/.test(url)) {
        event.preventDefault()
        return
      }
      const nextHost = safeHost(url)
      if (rootHost(nextHost) !== root && !SHARED_LOGIN_HOSTS.has(nextHost)) {
        event.preventDefault()
        void shell.openExternal(url)
        return
      }
      // 同一登录域内也过一遍白名单：SHARED_LOGIN_HOSTS 与 allowedViewUrls 是两套口径，
      // 这里取交集，避免出现「登录域允许、但不在受管视图白名单内」的漏网组合。
      try {
        assertViewUrlAllowed(url)
      } catch {
        event.preventDefault()
      }
    })

    wc.on('page-title-updated', (_e, title) => this.emitFromContents(wc, 'title', title))
    wc.on('did-start-loading', () => this.emitFromContents(wc, 'loading', null))
    wc.on('did-stop-loading', () => this.emitFromContents(wc, 'ready', wc.getURL()))
  }

  private emit(viewId: string, event: string, payload: unknown): void {
    this.hostWindow()?.webContents.send('view:state', { viewId, event, payload })
  }

  private emitFromContents(wc: Electron.WebContents, event: string, payload: unknown): void {
    const viewId = [...this.views.entries()].find(([, m]) => m.view.webContents === wc)?.[0]
    if (viewId) this.emit(viewId, event, payload)
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

let cachedBundle: { path: string; source: string } | null = null

function injectBundlePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'inject.bundle.js')
    : join(app.getAppPath(), 'resources', 'inject.bundle.js')
}

function readInjectBundle(): string | null {
  const path = injectBundlePath()
  if (!app.isPackaged) {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  }
  if (cachedBundle && cachedBundle.path === path) return cachedBundle.source
  if (!existsSync(path)) return null
  const source = readFileSync(path, 'utf-8')
  cachedBundle = { path, source }
  return source
}

export const viewManager = new WebContentsViewManager()
