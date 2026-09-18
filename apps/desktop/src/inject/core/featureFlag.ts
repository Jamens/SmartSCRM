const STORAGE_KEY = 'injectBackgroundModeV1'

/** WhatsApp-only background UI lightening toggle. */
export function isInjectBackgroundModeEnabled(platform: string, configuredValue?: boolean): boolean {
  if (platform !== 'WhatsApp') return false
  if (typeof configuredValue === 'boolean') return configuredValue
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export const INJECT_BACKGROUND_MODE_STORAGE_KEY = STORAGE_KEY
