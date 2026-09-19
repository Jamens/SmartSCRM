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
    String degradeReason
) {
}
