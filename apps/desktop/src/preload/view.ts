import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload for embedded third-party platform views (WhatsApp / Telegram ...).
 * Deliberately exposes ONLY the `window.ele` message bridge that the injected
 * scripts expect. It never surfaces session tokens or window controls.
 */
const ele = {
  sendToHost: (channel: string, data?: unknown): void => {
    ipcRenderer.send('view:toHost', { channel, data })
  },
  send: (channel: string, data?: unknown): void => {
    ipcRenderer.send('view:send', { channel, data })
  },
  invoke: <T = unknown>(channel: string, data?: unknown): Promise<T> =>
    ipcRenderer.invoke('view:invoke', { channel, data }) as Promise<T>,
  on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(`view:host:${channel}`, listener)
    return () => ipcRenderer.removeListener(`view:host:${channel}`, listener)
  }
}

contextBridge.exposeInMainWorld('ele', ele)
