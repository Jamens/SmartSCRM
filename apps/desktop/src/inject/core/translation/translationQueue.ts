import { TRANSLATE_THROTTLE_TIME } from '../../constants/config'
import { TRANSLATE_API } from '../../constants/events'
import type { BaseInjector } from '../BaseInjector'
import { translateKey } from '../../../shared/translateKey'

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
  /** 页内此刻看的会话提示。只用于本页 inflight 去重；到后端的那份由主进程重新盖章。 */
  chatHint?: string | null
  /** 页内 data-id（裸平台消息 id）。进 inflight 去重键，并由主进程透传给后端做消息级回显定位。 */
  msgId?: string
}

export interface TranslateResponse {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
  /** 线上线路失败或未配置密钥时为 true：译文来自本地模拟引擎，且该结果不入缓存 */
  degraded: boolean
  degradeReason: string | null
  /** false = 配置性死路（未配密钥 / 语种不支持）：重试不会好，页面上那颗按钮要换成一句说明。 */
  degradeRetryable: boolean
}

const inflight = new Map<string, Promise<TranslateResponse | null>>()
let lastStartedAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One shared pacing gate: the page can hold hundreds of bubbles but the backend needs calm. */
async function pace(): Promise<void> {
  const wait = lastStartedAt + TRANSLATE_THROTTLE_TIME - Date.now()
  if (wait > 0) await sleep(wait)
  lastStartedAt = Date.now()
}

export function requestTranslate(
  injector: BaseInjector,
  req: TranslateRequest
): Promise<TranslateResponse | null> {
  const key = translateKey(req)
  const running = inflight.get(key)
  if (running) return running

  const task = (async (): Promise<TranslateResponse | null> => {
    await pace()
    try {
      return (await injector.invoke<TranslateResponse>(TRANSLATE_API, req)) ?? null
    } catch {
      return null
    }
  })().finally(() => inflight.delete(key))

  inflight.set(key, task)
  return task
}
