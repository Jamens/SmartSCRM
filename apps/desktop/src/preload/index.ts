import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { BridgeState, LiveFrame, SendReceipt, SendRequest, StatusFrame } from '@shared/chatTypes'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  user: unknown
}

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewStateEvent {
  viewId: string
  event: 'created' | 'destroyed' | 'title' | 'loading' | 'ready'
  payload: unknown
}

export interface PageMessageEvent {
  viewId: string
  channel: string
  data: unknown
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
  },
  view: {
    create: (viewId: string, url: string): Promise<boolean> => ipcRenderer.invoke('wcv-create', viewId, url),
    destroy: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-destroy', viewId),
    show: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-show', viewId),
    hideAll: (): Promise<void> => ipcRenderer.invoke('wcv-hide-all'),
    setBounds: (viewId: string, rect: ViewBounds): Promise<void> => ipcRenderer.invoke('wcv-set-bounds', viewId, rect),
    reload: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-reload', viewId),
    navigate: (viewId: string, url: string): Promise<void> => ipcRenderer.invoke('wcv-navigate', viewId, url),
    executeJS: <T>(viewId: string, code: string): Promise<T> => ipcRenderer.invoke('wcv-execute-js', viewId, code),
    getOpenIds: (): Promise<string[]> => ipcRenderer.invoke('wcv-get-open-ids'),
    getActiveId: (): Promise<string | null> => ipcRenderer.invoke('wcv-get-active-id'),
    inject: (
      viewId: string,
      channel: string,
      config: Record<string, unknown>
    ): Promise<void> => ipcRenderer.invoke('wcv-inject', viewId, channel, config),
    uninject: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-uninject', viewId),
    sendToView: (viewId: string, channel: string, payload: unknown): Promise<boolean> =>
      ipcRenderer.invoke('wcv-send-to-view', viewId, channel, payload),
    onState: (callback: (state: ViewStateEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: ViewStateEvent): void => callback(state)
      ipcRenderer.on('view:state', listener)
      return () => ipcRenderer.removeListener('view:state', listener)
    },
    onPageMessage: (callback: (msg: PageMessageEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, msg: PageMessageEvent): void => callback(msg)
      ipcRenderer.on('view:page-message', listener)
      return () => ipcRenderer.removeListener('view:page-message', listener)
    }
  },
  /**
   * 聊天记录（P6）：三条 invoke + 三条推送（live 消息帧、status 状态帧、state 桥状态）。
   * 订阅型返回解绑函数，与 `win.onMaximizedChanged` 同形，渲染层卸载时不必知道 ipcRenderer 的存在。
   */
  msg: {
    send: (req: SendRequest): Promise<SendReceipt> => ipcRenderer.invoke('msg:send', req),
    syncHistory: (accountId: number): Promise<boolean> => ipcRenderer.invoke('msg:sync-history', accountId),
    bridges: (): Promise<BridgeState[]> => ipcRenderer.invoke('msg:bridges'),
    onLive: (callback: (frame: LiveFrame) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, frame: LiveFrame): void => callback(frame)
      ipcRenderer.on('msg:live', listener)
      return () => ipcRenderer.removeListener('msg:live', listener)
    },
    onStatus: (callback: (frame: StatusFrame) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, frame: StatusFrame): void => callback(frame)
      ipcRenderer.on('msg:status', listener)
      return () => ipcRenderer.removeListener('msg:status', listener)
    },
    onState: (callback: (states: BridgeState[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, states: BridgeState[]): void => callback(states)
      ipcRenderer.on('msg:state', listener)
      return () => ipcRenderer.removeListener('msg:state', listener)
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
