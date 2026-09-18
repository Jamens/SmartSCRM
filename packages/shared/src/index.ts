/**
 * Shared contract between desktop (Electron renderer/main) and server (Java).
 * Keep in sync with the Java DTOs under com.smartscrm.server.
 */

/** Platform type ids, matching the `platform_type` column stored by the server. */
export enum PlatformType {
  WhatsApp = 1,
  Line = 2,
  AIStar = 3,
  Telegram = 4,
  Facebook = 5,
  Messenger = 6,
  WhatsAppProtocol = 7
}

/** Material (quick-reply / send content) types. */
export enum MaterialType {
  Text = 0,
  Image = 1,
  Card = 2,
  Rich = 3,
  Mixed = 4,
  Button = 5
}

/** Translation provider channels. */
export enum TranslateChannel {
  Google = 1,
  DeepL = 2,
  ChatGPT = 3,
  Gemini = 4
}

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}
