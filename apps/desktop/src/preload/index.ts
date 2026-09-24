import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  BridgeState,
  LiveFrame,
  SendReceipt,
  SendRequest,
  StatusFrame
} from '@shared/chatTypes'
import type { AppSettings, ThemeSnapshot } from '../main/state/settings'
import type { BadgeEcho } from '@shared/badge'
import type { MachineProfile, StorageUsage } from '@shared/machine'

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
    getDeviceId: (): Promise<string> => ipcRenderer.invoke('app:get-device-id'),
    /**
     * 设备信息卡（A14）那十个字段。同步就有，所以这条 invoke 基本是瞬时回执；
     * 占用单独一条，理由见主进程 `services/machineProfile.ts` 的头注释。
     */
    getMachineProfile: (): Promise<MachineProfile> => ipcRenderer.invoke('app:get-machine-profile'),
    getStorageUsage: (): Promise<StorageUsage> => ipcRenderer.invoke('app:get-storage-usage')
  },
  session: {
    save: (session: StoredSession): Promise<boolean> => ipcRenderer.invoke('session:save', session),
    get: (): Promise<StoredSession | null> => ipcRenderer.invoke('session:get'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('session:clear')
  },
  /**
   * 用户设置。档位存在主进程，渲染层只是它的一个客户端——
   * 窗口底色与 nativeTheme 都由主进程解析，页面只拿到已经定好的 `effective`。
   */
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', patch),
    theme: (): Promise<ThemeSnapshot> => ipcRenderer.invoke('theme:get'),
    onThemeChanged: (callback: (snapshot: ThemeSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: ThemeSnapshot): void =>
        callback(snapshot)
      ipcRenderer.on('theme:changed', listener)
      return () => ipcRenderer.removeListener('theme:changed', listener)
    },
    // 与 `onThemeChanged` 分开的两条通道：操作系统翻深浅偏好只会发 theme，不会发这里。
    onChanged: (callback: (settings: AppSettings) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, settings: AppSettings): void => callback(settings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  /**
   * 任务栏未读角标。计数由渲染层算（未读总量 + 焦点 + 开关都只在渲染层齐全），
   * 返回值是主进程的回执，用来区分"平台不支持"与"调了但没成"，不是给界面看的。
   */
  badge: {
    set: (count: number): Promise<BadgeEcho> => ipcRenderer.invoke('badge:set', count)
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
    create: (viewId: string, url: string): Promise<boolean> =>
      ipcRenderer.invoke('wcv-create', viewId, url),
    destroy: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-destroy', viewId),
    show: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-show', viewId),
    hideAll: (): Promise<void> => ipcRenderer.invoke('wcv-hide-all'),
    setBounds: (viewId: string, rect: ViewBounds): Promise<void> =>
      ipcRenderer.invoke('wcv-set-bounds', viewId, rect),
    reload: (viewId: string): Promise<void> => ipcRenderer.invoke('wcv-reload', viewId),
    navigate: (viewId: string, url: string): Promise<void> =>
      ipcRenderer.invoke('wcv-navigate', viewId, url),
    executeJS: <T>(viewId: string, code: string): Promise<T> =>
      ipcRenderer.invoke('wcv-execute-js', viewId, code),
    getOpenIds: (): Promise<string[]> => ipcRenderer.invoke('wcv-get-open-ids'),
    getActiveId: (): Promise<string | null> => ipcRenderer.invoke('wcv-get-active-id'),
    inject: (viewId: string, channel: string, config: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('wcv-inject', viewId, channel, config),
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
    syncHistory: (accountId: number): Promise<boolean> =>
      ipcRenderer.invoke('msg:sync-history', accountId),
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
