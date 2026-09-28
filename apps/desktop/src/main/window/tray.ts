import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { showMainWindow, setQuitting } from './mainWindow'

let tray: Tray | null = null

export function createTray(): void {
  if (tray) return
  const iconPath = join(app.getAppPath(), 'resources/icon.png')
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') image.resize({ width: 18, height: 18 })

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip(app.getName())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 SmartSCRM',
        click: () => showMainWindow()
      },
      { type: 'separator' },
      {
        label: '退出',
        // 不提前 destroy 主窗口：`before-quit` 里的视图清理要面对一个还活着的宿主窗口，
        // 否则 `destroyView` 读 `win.contentView` 会抛「Object has been destroyed」并弹出主进程错误框。
        click: () => {
          setQuitting(true)
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => showMainWindow())
}
