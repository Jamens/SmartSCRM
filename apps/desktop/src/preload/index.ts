import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  user: unknown
}

const scrm = {
  app: {
    getDeviceId: (): Promise<string> => ipcRenderer.invoke('app:get-device-id')
  },
  session: {
    save: (session: StoredSession): Promise<boolean> => ipcRenderer.invoke('session:save', session),
    get: (): Promise<StoredSession | null> => ipcRenderer.invoke('session:get'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('session:clear')
  },
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:is-maximized'),
    onMaximizedChanged: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean): void => callback(maximized)
      ipcRenderer.on('win:maximized-changed', listener)
      return () => ipcRenderer.removeListener('win:maximized-changed', listener)
    }
  }
}

export type ScrmApi = typeof scrm

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('scrm', scrm)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.scrm = scrm
}
