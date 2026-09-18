import { ipcMain, type Rectangle } from 'electron'
import { viewManager } from './manager'

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
}
