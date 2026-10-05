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
import type { BatchProgress, BatchRecallResult, BatchStateEvent } from '@shared/batchSend'
import type {
  GroupBuildOutcome,
  GroupExportResult,
  GroupStateEvent
} from '@shared/groupMembers'
import type { MachineProfile, StorageUsage } from '@shared/machine'
import type { PerfMetrics } from '@shared/perf'
import type {
  NotifyClickTarget,
  NotifyShowRequest,
  NotifyVerdict
} from '@shared/notification'
import type { GpuFatalInfo } from '@shared/gpu'
import type { LogEntry, LogFilter } from '@shared/log'

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
    getStorageUsage: (): Promise<StorageUsage> => ipcRenderer.invoke('app:get-storage-usage'),
    /** 内存/性能监控（A7）：主进程自己的运行时指标，纯内存读取。 */
    getPerfMetrics: (): Promise<PerfMetrics> => ipcRenderer.invoke('app:get-perf-metrics')
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
  /**
   * 桌面消息通知（A17）：一条 invoke（提请弹窗）+ 一条推送（用户点了某条通知）。
   * 与角标同一分工——渲染层知道"这一帧该不该提请"，主进程负责跨帧合并与真的弹。
   * 回执是"排进去了"（`queued`）而不是"弹了"：合并窗口到点才真弹，渲染层不该据此判定成败。
   */
  notify: {
    show: (req: NotifyShowRequest): Promise<NotifyVerdict> =>
      ipcRenderer.invoke('notify:show', req),
    onClicked: (callback: (target: NotifyClickTarget) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, target: NotifyClickTarget): void => callback(target)
      ipcRenderer.on('notify:clicked', listener)
      return () => ipcRenderer.removeListener('notify:clicked', listener)
    }
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
  /**
   * 图形降级（A18）。渲染层只负责把"用户想要的模式"写进设置并请求重启，真正的带参重启在主进程。
   * `onFatal` 是降级模式下 GPU 仍崩溃时的反向推送——那时不能再重启（会死循环），只能提示排查驱动。
   */
  gpu: {
    restart: (desiredDegraded: boolean): Promise<boolean> =>
      ipcRenderer.invoke('gpu:restart', desiredDegraded),
    onFatal: (callback: (info: GpuFatalInfo) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, info: GpuFatalInfo): void => callback(info)
      ipcRenderer.on('gpu:fatal', listener)
      return () => ipcRenderer.removeListener('gpu:fatal', listener)
    }
  },
  /**
   * 日志中心（A19）。渲染层只读内存环（latest N 条），不读磁盘大文件；
   * 「打开日志目录」走系统文件管理器。所有日志只落本地、不上报服务端。
   */
  logs: {
    list: (filter?: LogFilter): Promise<LogEntry[]> => ipcRenderer.invoke('logs:list', filter),
    openFolder: (): Promise<void> => ipcRenderer.invoke('logs:open-folder'),
    clear: (): Promise<void> => ipcRenderer.invoke('logs:clear')
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
  },
  /**
   * 批量群发（P7/B7）：六条 invoke + 一条 `batch:state` 推送。
   * `start`/`resume` 在主进程迁移成功后顺手把待跑明细交给引擎，渲染层不许自己拼"先 start 再 run"
   * 两次调用（M2：`batch:run` 那一跳已删——它是「两条泵」的潜在入口，渲染层零调用，见 host.ts）；
   * `onState` 只是"进度变了"的通知，数字仍以渲染层 GET 回来的那一份为准。
   */
  batch: {
    start: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:start', taskId),
    pause: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:pause', taskId),
    resume: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:resume', taskId),
    cancel: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:cancel', taskId),
    retryFailed: (taskId: number, detailIds?: number[]): Promise<number | null> =>
      ipcRenderer.invoke('batch:retry-failed', taskId, detailIds),
    recall: (taskId: number, detailIds: number[]): Promise<BatchRecallResult> =>
      ipcRenderer.invoke('batch:recall', taskId, detailIds),
    onState: (cb: (e: BatchStateEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, e: BatchStateEvent): void => cb(e)
      ipcRenderer.on('batch:state', listener)
      return () => ipcRenderer.removeListener('batch:state', listener)
    }
  },
  /**
   * 群成员（P8/B6）：两条 invoke + 一条推送。
   * 五个读端点不在这里——渲染层 `lib/http.ts` 自己带 token 对与 401 刷新链，做成 IPC 转发
   * 只会多出五份 dead code 与两条白名单（R26）。留着这两条的理由是它们必须经主进程：
   * 建档命令要下给内嵌页（页里才有 wa-js），导出要在主进程编码 XLSX（渲染包不带编码库）。
   */
  group: {
    /** `chatKey` 省略 = 整账号一轮；带上 = 只补这一群（R49 单数码）。整轮跑完才 resolve。 */
    build: (req: { accountId: number; chatKey?: string }): Promise<GroupBuildOutcome | null> =>
      ipcRenderer.invoke('group:build', req),
    export: (req: { accountId: number; chatKeys: string[] }): Promise<GroupExportResult | null> =>
      ipcRenderer.invoke('group:export', req),
    onState: (cb: (e: GroupStateEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, e: GroupStateEvent): void => cb(e)
      ipcRenderer.on('group:state', listener)
      return () => ipcRenderer.removeListener('group:state', listener)
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
