import { ElectronAPI } from '@electron-toolkit/preload'
import type { ScrmApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    scrm?: ScrmApi
  }
}

export {}
