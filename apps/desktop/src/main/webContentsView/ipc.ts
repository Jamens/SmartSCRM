import { ipcMain, type Rectangle, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { viewManager } from './manager'
import { getMainWindow } from '../window/mainWindow'

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
  'auth-status-change'
])

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

  // Page (injected script) -> host window. `event.sender` identifies which view sent it.
  const routePageMessage = (event: IpcMainEvent, kind: 'toHost' | 'send', arg: { channel: string; data: unknown }): void => {
    const viewId = viewManager.getViewIdByWebContents(event.sender.id)
    if (!viewId || !arg || !ALLOWED_HOST_CHANNELS.has(arg.channel)) return
    forwardToHost(viewId, `${kind}:${arg.channel}`, arg.data)
  }
  ipcMain.on('view:toHost', (event, arg) => routePageMessage(event, 'toHost', arg))
  ipcMain.on('view:send', (event, arg) => routePageMessage(event, 'send', arg))

  // Page -> host request/response. Translation & data APIs are mocked until their phases land.
  ipcMain.handle('view:invoke', (_event: IpcMainInvokeEvent, arg: { channel: string; data: unknown }) => {
    return { ok: true, mocked: true, channel: arg?.channel ?? null, data: null }
  })
}
