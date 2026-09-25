import { useEffect, useRef } from 'react'
import { useTranslationSettings, type TranslationSettingVO } from '@/api/translation'
import { GLOBAL_REF } from '@/lib/scopeLabel'
import { viewService } from '@/services/viewService'

const CHANNEL = 'update-translation-flags'
/**
 * 注入层挂载完成的上报通道（BaseInjector 经 sendToHost 发出，主进程加 `toHost:` 前缀转发）。
 * 开关只活在注入层实例里，而切走路由会让舞台卸载、页面被 uninject——
 * 回到工作台重新注入的是一个刚出厂的实例，默认值会把用户改过的设置盖掉。
 * 所以让页面每次挂载主动来取一次，而不是指望某一次广播恰好落在它身上。
 */
const READY_CHANNEL = 'toHost:injector-ready'

export interface TranslationFlagsPayload {
  receiveEnabled: boolean
  sendEnabled: boolean
  previewEnabled: boolean
  enterToSend: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
  revision: number
}

let revision = 0
let latest: TranslationFlagsPayload | null = null
let lastFingerprint = ''

/** Only a real change bumps the revision, so an idle refetch never wipes rendered bubbles. */
export function fingerprintOf(settings: TranslationSettingVO): string {
  return JSON.stringify(settings)
}

function flagsOf(settings: TranslationSettingVO): TranslationFlagsPayload {
  if (fingerprintOf(settings) !== lastFingerprint) {
    lastFingerprint = fingerprintOf(settings)
    revision += 1
  }
  return {
    receiveEnabled: settings.receiveEnabled,
    sendEnabled: settings.sendEnabled,
    previewEnabled: settings.previewEnabled,
    enterToSend: settings.enterToSend,
    disableChinese: settings.disableChinese,
    disableChinesePreventSend: settings.disableChinesePreventSend,
    revision
  }
}

export async function broadcastTranslationFlags(settings: TranslationSettingVO): Promise<number> {
  const flags = flagsOf(settings)
  latest = flags
  const viewIds = await viewService.getOpenIds()
  const results = await Promise.all(viewIds.map((id) => viewService.sendToView(id, CHANNEL, flags)))
  return results.filter(Boolean).length
}

/**
 * Mounted once in AppLayout: keeps every embedded page in sync with the stored toggles,
 * including views created after the last settings change (spec §5.4).
 */
export function useTranslationSync(): void {
  const settingsQuery = useTranslationSettings(GLOBAL_REF)
  const pushed = useRef(false)

  useEffect(() => {
    if (settingsQuery.data && !pushed.current) {
      pushed.current = true
      void broadcastTranslationFlags(settingsQuery.data)
    }
  }, [settingsQuery.data])

  useEffect(
    () =>
      viewService.onState((state) => {
        if (state.event !== 'created' || !latest) return
        void viewService.sendToView(state.viewId, CHANNEL, latest)
      }),
    []
  )

  // 页面主动报到才算它准备好了：广播可能发生在它被注入之前，那时没有接收方。
  useEffect(
    () =>
      viewService.onPageMessage((msg) => {
        if (msg.channel !== READY_CHANNEL || !msg.viewId || !latest) return
        void viewService.sendToView(msg.viewId, CHANNEL, latest)
      }),
    []
  )
}
