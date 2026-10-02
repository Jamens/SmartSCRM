import { app, BrowserWindow, screen } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, setQuitting } from './window/mainWindow'
import { createTray } from './window/tray'
import { attachWindowEvents, registerIpcHandlers } from './ipc'
import { viewManager } from './webContentsView/manager'
import { startMsgBridge, stopMsgBridge } from './services/msgBridge'
import { startBatchHost, stopBatchHost } from './services/batchSend/host'
import { startGroupHost, stopGroupHost } from './services/groupCollect/host'
import { applyThemeSource, loadSettings } from './state/settings'
import { applyGpuLaunchMode, ensureGpuModeBeforeWindow, registerGpuCrashHandler } from './gpu'
import { flushLogs, installIpcLogging, installLogger } from './logger'

// 越早越好：GPU 后端必须在 app.ready 之前定下来（win32 上再晚一步就来不及换渲染后端）。
// 只认启动参数；设置里的偏好由 whenReady 内的 ensureGpuModeBeforeWindow 再补一次重启。
applyGpuLaunchMode()

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

    // 日志中心（A19）：尽早装配，启动期的 console 与本进程错误都要进日志。
    installLogger()

    // 先读设置再建窗：窗口底色要吃档位，晚一步就会先闪一帧错的底色。
    applyThemeSource(loadSettings())

    // 设置表明本应降级但本次没带降级参数（例如刚改了开关、进程还没重启）→ 补一次带参重启。
    // 返回 true 表示已经重启，后面的建窗逻辑不该再跑。
    if (ensureGpuModeBeforeWindow()) return

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 包一层 ipcMain.handle 记录每次渲染↔主进程调用（A19），必须在 registerIpcHandlers 之前。
    installIpcLogging()
    registerIpcHandlers()
    startMsgBridge()
    startBatchHost()
    startGroupHost()
    const mainWindow = createMainWindow()
    attachWindowEvents(mainWindow)
    createTray()

    // 内嵌页的缩放跟主窗口对齐；显示器 / DPI 变化时再同步一次，避免拖到另一块屏上比例漂移。
    viewManager.syncZoomToWindow()
    screen.on('display-metrics-changed', () => viewManager.syncZoomToWindow())

    // 崩溃检测必须在运行期注册（GPU 子进程只在 app 起来后才可能崩）。
    registerGpuCrashHandler()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    setQuitting(true)
    void stopMsgBridge()
    void stopBatchHost()   // 这里不 await：before-quit 不等监听器的返回值，而 stopBatchHost 体内没有异步等待点
    void stopGroupHost()   // 同上：flush 的 await 在宿主内部，before-quit 不等它的返回值
    flushLogs()            // A19：退出前把内存里攒着的日志落盘，否则最后 1.5s 的日志会丢
    viewManager.destroyAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
