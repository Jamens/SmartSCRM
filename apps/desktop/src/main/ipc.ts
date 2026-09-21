import { BrowserWindow, ipcMain } from 'electron'
import { clearSession, getDeviceId, getSession, saveSession, type StoredSession } from './state/session'
import { bridgeStates, requestBackfill, sendText } from './services/msgBridge'
import { getMainWindow, showMainWindow } from './window/mainWindow'
import { registerViewIpc } from './webContentsView/ipc'
import type { SendRequest } from '@shared/chatTypes'

export function registerIpcHandlers(): void {
  registerViewIpc()

  ipcMain.handle('app:get-device-id', () => getDeviceId())

  ipcMain.handle('session:save', (_event, session: StoredSession) => {
    saveSession(session)
    return true
  })
  ipcMain.handle('session:get', () => getSession())
  ipcMain.handle('session:clear', () => {
    clearSession()
    return true
  })

  /** 记录页回复：localId 由渲染层生成（乐观气泡的 key），主进程原样回带。 */
  ipcMain.handle('msg:send', (_e, req: SendRequest) => sendText(req))
  ipcMain.handle('msg:sync-history', (_e, accountId: number) => requestBackfill(accountId))
  ipcMain.handle('msg:bridges', () => bridgeStates())

  const focused = (): BrowserWindow | null => getMainWindow() ?? BrowserWindow.getFocusedWindow()

  ipcMain.handle('win:minimize', () => focused()?.minimize())
  ipcMain.handle('win:toggle-maximize', () => {
    const win = focused()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('win:close', () => focused()?.close())
  ipcMain.handle('win:is-maximized', () => focused()?.isMaximized() ?? false)
  ipcMain.handle('win:show', () => showMainWindow())
}

/** Push maximize-state changes to the renderer so the custom title bar stays in sync. */
export function attachWindowEvents(win: BrowserWindow): void {
  const send = (maximized: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send('win:maximized-changed', maximized)
  }
  win.on('maximize', () => send(true))
  win.on('unmaximize', () => send(false))
}
