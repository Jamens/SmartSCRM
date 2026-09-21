import { ipcMain, type Rectangle, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { viewManager } from './manager'
import { getMainWindow } from '../window/mainWindow'
import { requestTranslation } from '../services/translationBridge'
import { handleBridgeReport, observeLoginStatus } from '../services/msgBridge'

/** Channels an embedded page is allowed to push up to the host window. */
const ALLOWED_HOST_CHANNELS = new Set<string>([
  'injector-ready',
  'login-status',
  'operateLogs',
  'error-msg-tips',
  'report-error',
  'upload-msg',
  'get-new-message',
  'update-unread-count',
  'translation-flags-applied',
  'auth-status-change',
  /** 消息桥的唯一上行通道；它不改转发给渲染层，而是进 msgBridge。 */
  'msg-report'
])

/** Channels an embedded page may ask the host to serve. */
const ALLOWED_INVOKE_CHANNELS = new Set<string>(['translate-api'])
/** Channels the host renderer may push into an embedded page. */
const ALLOWED_PUSH_CHANNELS = new Set<string>([
  'update-translation-flags',
  /** 记录页可以直接命令某个视图"打开这个会话"；主进程自己走 viewManager.sendToView，不经这里。 */
  'msg-cmd'
])
const RATE_WINDOW_MS = 1000
const RATE_LIMIT = 20
const rateBuckets = new Map<string, { windowStart: number; count: number }>()

function rateLimited(viewId: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(viewId)
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(viewId, { windowStart: now, count: 1 })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT
}

function forwardToHost(viewId: string, channel: string, data: unknown): void {
  getMainWindow()?.webContents.send('view:page-message', { viewId, channel, data })
}

export function registerViewIpc(): void {
  ipcMain.handle('wcv-create', (_e, viewId: string, url: string) => viewManager.createView(viewId, url))
  ipcMain.handle('wcv-destroy', (_e, viewId: string) => viewManager.destroyView(viewId))
  ipcMain.handle('wcv-show', (_e, viewId: string) => viewManager.showView(viewId))
  ipcMain.handle('wcv-hide-all', () => viewManager.hideAll())
  ipcMain.handle('wcv-set-bounds', (_e, viewId: string, rect: Rectangle) => viewManager.setBounds(viewId, rect))
  ipcMain.handle('wcv-reload', (_e, viewId: string) => viewManager.reload(viewId))
  ipcMain.handle('wcv-navigate', (_e, viewId: string, url: string) => viewManager.navigate(viewId, url))
  ipcMain.handle('wcv-execute-js', (_e, viewId: string, code: string) => viewManager.executeJS(viewId, code))
  ipcMain.handle('wcv-get-open-ids', () => viewManager.getOpenIds())
  ipcMain.handle('wcv-get-active-id', () => viewManager.getActiveId())
  ipcMain.handle(
    'wcv-inject',
    (_e, viewId: string, channel: string, config: Record<string, unknown>) =>
      viewManager.inject(viewId, channel, config)
  )
  ipcMain.handle('wcv-uninject', (_e, viewId: string) => viewManager.uninject(viewId))
  ipcMain.handle('wcv-send-to-view', (_e, viewId: string, channel: string, payload: unknown) => {
    if (!ALLOWED_PUSH_CHANNELS.has(channel)) return false
    return viewManager.sendToView(viewId, channel, payload)
  })

  // Page (injected script) -> host window. `event.sender` identifies which view sent it.
  const routePageMessage = (event: IpcMainEvent, kind: 'toHost' | 'send', arg: { channel: string; data: unknown }): void => {
    const viewId = viewManager.getViewIdByWebContents(event.sender.id)
    if (!viewId || !arg || !ALLOWED_HOST_CHANNELS.has(arg.channel)) return
    if (arg.channel === 'msg-report') {
      // 分流后不再转给渲染层：渲染层从 `msg:live` 吃尾巴，避免同一帧两份副本。
      handleBridgeReport(viewId, arg.data)
      return
    }
    if (arg.channel === 'login-status') {
      observeLoginStatus(viewId, (arg.data as { isLogin?: boolean } | null)?.isLogin === true)
      // 仍然转发：渲染层的 useLoginStatusSync 要把在线态写回账号行。
    }
    forwardToHost(viewId, `${kind}:${arg.channel}`, arg.data)
  }
  ipcMain.on('view:toHost', (event, arg) => routePageMessage(event, 'toHost', arg))
  ipcMain.on('view:send', (event, arg) => routePageMessage(event, 'send', arg))

  // Page -> host request/response. Only whitelisted channels reach the backend, and the
  // page can never name a language, a channel or a token (spec §4.2).
  ipcMain.handle(
    'view:invoke',
    async (event: IpcMainInvokeEvent, arg: { channel: string; data: unknown }) => {
      if (!arg || !ALLOWED_INVOKE_CHANNELS.has(arg.channel)) return null
      const viewId = viewManager.getViewIdByWebContents(event.sender.id)
      if (!viewId || rateLimited(viewId)) return null
      const req = arg.data as Partial<{ text: string; type: string; input: boolean; noCache: boolean }> | undefined
      const text = typeof req?.text === 'string' ? req.text : ''
      if (!text || text.length > 5000) return null
      const type = req?.type === 'send' ? 'send' : 'receive'
      const apiBase = viewManager.getInjectConfig(viewId)?.apiBase
      return requestTranslation(
        {
          text,
          type,
          ...(req?.input === true ? { input: true } : {}),
          ...(req?.noCache === true ? { noCache: true } : {})
        },
        typeof apiBase === 'string' ? apiBase : undefined
      )
    }
  )
}
