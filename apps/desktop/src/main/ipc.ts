import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { windowBackgroundOf } from '@shared/theme'
import type { BadgeEcho } from '@shared/badge'
import {
  clearSession,
  getDeviceId,
  getSession,
  saveSession,
  type StoredSession
} from './state/session'
import {
  applyThemeSource,
  getSettings,
  patchSettings,
  themeSnapshot,
  type AppSettings
} from './state/settings'
import { bridgeStates, requestBackfill, sendText } from './services/msgBridge'
import { readMachineProfile, readStorageUsage } from './services/machineProfile'
import { getMainWindow, showMainWindow } from './window/mainWindow'
import { setUnreadBadge } from './window/badge'
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

/**
 * 整份设置广播。与 `theme:changed` 分开两条通道：档位翻转（操作系统改了偏好）只动主题，
 * 不该让设置类订阅者以为开关也被人改过；反过来设置变了必然带上主题，所以 `settings:set` 两条都发。
 */
function broadcastSettings(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('settings:changed', getSettings())
}

export function registerIpcHandlers(): void {
  registerViewIpc()

  ipcMain.handle('app:get-device-id', () => getDeviceId())

  // 设备信息（A14）。两条通道分开：这十个字段是进程里的常量，同步就有；
  // 目录占用要遍历磁盘，可能上百毫秒，让它单独转，别把前半张卡片一起拖住。
  ipcMain.handle('app:get-machine-profile', () => readMachineProfile())
  ipcMain.handle('app:get-storage-usage', () => readStorageUsage())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_event, patch: Partial<AppSettings>) => {
    const next = patchSettings(patch)
    applyThemeSource(next)
    broadcastSettings()
    broadcastTheme()
    return next
  })
  ipcMain.handle('theme:get', () => themeSnapshot())

  // 未读角标：渲染层算该报几（`@shared/badge` 的规则），这里只管推给平台并如实回执。
  ipcMain.handle('badge:set', (_event, count: unknown): BadgeEcho =>
    setUnreadBadge(getMainWindow(), count)
  )

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
