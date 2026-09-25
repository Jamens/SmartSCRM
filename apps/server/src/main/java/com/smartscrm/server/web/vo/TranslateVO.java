package com.smartscrm.server.web.vo;

public record TranslateVO(
    String translation,
    boolean cached,
    boolean partial,
    boolean containsChinese,
    String type,
    String channel,
    String fromLangCode,
    String toLangCode,
    String cacheKey,
    /** True when an online channel could not be used and the local engine answered instead. */
    boolean degraded,
    /** Why the result is degraded: "未配置密钥" or the vendor error; null otherwise. */
    String degradeReason,
    /**
     * 这次实际用了哪一档：'global' | 'customer' | 'conversation'（spec §3.2）。
     * 与 GET /settings 的 `scope` 同一取值、同一含义，但它是**这一次翻译**的档位——
     * 记录页回复框要在译出之后如实说这一句（§4③），因为屏幕上那枚档位来自更早的一次 GET。
     */
    String scope
) {
}
