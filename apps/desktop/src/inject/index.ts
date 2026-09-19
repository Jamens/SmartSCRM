import { VERSION } from './constants/config'
import { BaseInjector } from './core/BaseInjector'
import { PlatformAdapter } from './core/PlatformAdapter'
import { WhatsAppAdapter } from './platforms/whatsapp'
import { TelegramAdapter } from './platforms/telegram'
import { INJECTOR_READY } from './constants/events'
import type { InjectConfig } from './types'
import * as Channels from './constants/channels'

/** Channel name -> adapter class. Extend as LINE/Facebook/Messenger are ported. */
const adapters: Record<string, new () => PlatformAdapter> = {
  [Channels.WHATSAPP]: WhatsAppAdapter,
  [Channels.TELEGRAM]: TelegramAdapter
}

async function injectPlatform(platform: string, config: InjectConfig): Promise<{ isLogin: string }> {
  console.log(`[SCRM Inject v${VERSION}] 开始注入: ${platform}`, config)

  const AdapterClass = adapters[platform]
  if (!AdapterClass) {
    console.warn(`[SCRM Inject] 未知或不支持的平台: ${platform}`)
    return { isLogin: 'false' }
  }

  // 同一个页面里只允许存在一个注入器：主进程会在页面每次就绪时重新注入，渲染层重挂载也会再注入一次。
  // 不做这步清理的话，旧的登录轮询和消息轮询会一直留在页面里，按份数重复上报。
  window.__SCRM_DESTROY__?.()

  const adapter = new AdapterClass()
  const injector = new BaseInjector(adapter, config)
  const result = await injector.inject()

  window.__SCRM_ADAPTER__ = adapter
  window.__SCRM_INJECTOR__ = injector
  window.ele?.sendToHost(INJECTOR_READY, { webviewId: config.webviewId, platform })

  console.log(`[SCRM Inject v${VERSION}] ${platform} 注入完成`)
  return result
}

window.__SCRM_INJECT__ = injectPlatform
window.__SCRM_GET_ADAPTER__ = () => window.__SCRM_ADAPTER__
window.__SCRM_GET_INJECTOR__ = () => window.__SCRM_INJECTOR__
window.__SCRM_DESTROY__ = () => {
  const injector = window.__SCRM_INJECTOR__ as BaseInjector | null
  const adapter = window.__SCRM_ADAPTER__ as PlatformAdapter | null
  injector?.destroy?.()
  adapter?.cleanup?.()
  window.__SCRM_INJECTOR__ = null
  window.__SCRM_ADAPTER__ = null
}
window.__SCRM_INJECT_VERSION__ = VERSION
window.__SCRM_PLATFORMS__ = {
  WHATSAPP: Channels.WHATSAPP,
  TELEGRAM: Channels.TELEGRAM,
  LINE: Channels.LINE,
  FACEBOOK: Channels.FACEBOOK,
  MESSENGER: Channels.MESSENGER
}

export { injectPlatform, VERSION, PlatformAdapter, WhatsAppAdapter, TelegramAdapter }
