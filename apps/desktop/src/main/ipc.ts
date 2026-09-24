import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { windowBackgroundOf } from '@shared/theme'
import { clearSession, getDeviceId, getSession, saveSession, type StoredSession } from './state/session'
import {
  applyThemeSource,
  getSettings,
  patchSettings,
  themeSnapshot,
  type AppSettings
} from './state/settings'
import { bridgeStates, requestBackfill, sendText } from './services/msgBridge'
import { getMainWindow, showMainWindow } from './window/mainWindow'
import { registerViewIpc } from './webContentsView/ipc'
import type { SendRequest } from '@shared/chatTypes'

/**
 * 把当前档位推给渲染层，同时改掉窗口底色。
 * 只发类名不改窗口底色的话，切档后窗口边缘（圆角、缩放露出的那条）会留着旧色。
 */
function broadcastTheme(): void {
  const snapshot = themeSnapshot()
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.setBackgroundColor(windowBackgroundOf(snapshot.effective))
  win.webContents.send('theme:changed', snapshot)
}

export function registerIpcHandlers(): void {
  registerViewIpc()

  ipcMain.handle('app:get-device-id', () => getDeviceId())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_event, patch: Partial<AppSettings>) => {
    const next = patchSettings(patch)
    applyThemeSource(next)
    broadcastTheme()
    return next
  })
  ipcMain.handle('theme:get', () => themeSnapshot())

  // system 档下操作系统的深浅偏好会在运行中翻转，主进程是唯一的真值来源，所以由它推。
  // 事件名是 `updated`（不是 `update`）——写错的话 typecheck 会拦，运行时不会有任何提示。
  nativeTheme.on('updated', () => broadcastTheme())

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
