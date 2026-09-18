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

type ViewApi = NonNullable<Window['scrm']>['view']

const noop = (): Promise<void> => Promise.resolve()
const noVal = <T>(v: T): (() => Promise<T>) => () => Promise.resolve(v)

/** Browser fallback so the renderer still runs outside Electron during plain `vite` dev. */
const fallback: ViewApi = {
  create: noVal(false),
  destroy: noop,
  show: noop,
  hideAll: noop,
  setBounds: noop,
  reload: noop,
  navigate: noop,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  executeJS: <T>(_viewId: string, _code: string): Promise<T> => Promise.resolve(undefined as T),
  getOpenIds: noVal<string[]>([]),
  getActiveId: noVal<string | null>(null),
  inject: noop,
  uninject: noop,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendToView: (_viewId: string, _channel: string, _payload: unknown): Promise<boolean> =>
    Promise.resolve(false),
  onState: () => () => {},
  onPageMessage: () => () => {}
}

export const isElectron = typeof window !== 'undefined' && !!window.scrm

export const viewService: ViewApi & { isElectron: boolean } = {
  ...(window.scrm?.view ?? fallback),
  isElectron
}
