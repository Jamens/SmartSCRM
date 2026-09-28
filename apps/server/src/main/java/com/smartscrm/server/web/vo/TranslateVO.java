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
    String scope,
    /**
     * 这次降级重试得了吗：{@code false} = 配置性死路（未配置密钥 / 语种不支持），
     * 页面上那颗「点此重试」点了也不会好，要换成一句说明。只在 {@code degraded} 为真时才有意义，
     * 所以读它之前先读 {@code degraded}。分岔发生在抛出点（{@code ProviderException.retryable()}）。
     */
    boolean degradeRetryable
) {
}
