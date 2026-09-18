import { useEffect, useRef } from 'react'
import { useTranslationSettings, type TranslationSettingVO } from '@/api/translation'
import { viewService } from '@/services/viewService'

const CHANNEL = 'update-translation-flags'

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
  const settingsQuery = useTranslationSettings()
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
}
