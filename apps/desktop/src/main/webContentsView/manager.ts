import { WebContentsView, shell, BrowserWindow, type Rectangle } from 'electron'
import { getMainWindow } from '../window/mainWindow'

interface ManagedView {
  view: WebContentsView
  url: string
  host: string
  visible: boolean
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

  private hostWindow(): BrowserWindow | null {
    return getMainWindow()
  }

  createView(viewId: string, url: string): boolean {
    if (this.views.has(viewId)) {
      this.showView(viewId)
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
        sandbox: true
      }
    })

    try {
      const host = new URL(url).hostname
      this.attachNavigationGuard(view, host)
    } catch {
      /* invalid url surfaces on loadURL below */
    }

    win.contentView.addChildView(view)
    view.setBounds(HIDDEN)
    view.setVisible(false)

    this.views.set(viewId, { view, url, host: safeHost(url), visible: false })
    view.webContents.loadURL(url)
    this.emit(viewId, 'created', url)
    return true
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

  navigate(viewId: string, url: string): void {
    const managed = this.views.get(viewId)
    if (managed) {
      managed.url = url
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
    win?.contentView.removeChildView(managed.view)
    managed.view.webContents.close()
    this.views.delete(viewId)
    if (this.activeViewId === viewId) this.activeViewId = null
    this.emit(viewId, 'destroyed', managed.url)
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
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    wc.on('will-navigate', (event, url) => {
      if (!/^https?:/.test(url)) return
      const nextHost = safeHost(url)
      if (rootHost(nextHost) !== root && !SHARED_LOGIN_HOSTS.has(nextHost)) {
        event.preventDefault()
        void shell.openExternal(url)
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

export const viewManager = new WebContentsViewManager()
