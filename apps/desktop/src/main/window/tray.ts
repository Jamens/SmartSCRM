import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { getMainWindow, showMainWindow, setQuitting } from './mainWindow'

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
        click: () => {
          setQuitting(true)
          getMainWindow()?.destroy()
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => showMainWindow())
}
