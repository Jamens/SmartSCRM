import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, setQuitting } from './window/mainWindow'
import { createTray } from './window/tray'
import { attachWindowEvents, registerIpcHandlers } from './ipc'
import { viewManager } from './webContentsView/manager'
import { startMsgBridge, stopMsgBridge } from './services/msgBridge'
import { startBatchHost, stopBatchHost } from './services/batchSend/host'
import { startGroupHost, stopGroupHost } from './services/groupCollect/host'
import { applyThemeSource, loadSettings } from './state/settings'

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.smartscrm.desktop')

    // 先读设置再建窗：窗口底色要吃档位，晚一步就会先闪一帧错的底色。
    applyThemeSource(loadSettings())

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    startMsgBridge()
    startBatchHost()
    startGroupHost()
    const mainWindow = createMainWindow()
    attachWindowEvents(mainWindow)
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    setQuitting(true)
    void stopMsgBridge()
    void stopBatchHost()   // 这里不 await：before-quit 不等监听器的返回值，而 stopBatchHost 体内没有异步等待点
    void stopGroupHost()   // 同上：flush 的 await 在宿主内部，before-quit 不等它的返回值
    viewManager.destroyAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
