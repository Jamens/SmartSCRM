/** Platform names as they appear in account rows and inject config. */

export const WHATSAPP = 'WhatsApp'
export const AISTAR = 'AIStar'
export const TELEGRAM = 'Telegram'
export const LINE = 'Line'
export const FACEBOOK = 'Facebook'
export const MESSENGER = 'Messenger'

/** Positions define the numeric codes in CHANNEL_INDEX; keep the two lists in the same order. */
export const CHANNEL_CODE = [WHATSAPP, AISTAR, TELEGRAM, LINE, FACEBOOK, MESSENGER] as const

export const CHANNEL_INDEX: Record<string, number> = {
  [WHATSAPP]: 0,
  [AISTAR]: 1,
  [TELEGRAM]: 2,
  [LINE]: 3,
  [FACEBOOK]: 4,
  [MESSENGER]: 5
}

export const INJECTABLE_CHANNELS: string[] = [WHATSAPP, TELEGRAM, LINE, FACEBOOK, MESSENGER]
export const VOICE_SUPPORTED_CHANNELS: string[] = [WHATSAPP, TELEGRAM, LINE]
export const LEXICAL_CHANNELS: string[] = [FACEBOOK, MESSENGER]

export function isValidChannel(channel: string): boolean {
  return (CHANNEL_CODE as readonly string[]).includes(channel)
}

export function isInjectable(channel: string): boolean {
  return INJECTABLE_CHANNELS.includes(channel)
}
