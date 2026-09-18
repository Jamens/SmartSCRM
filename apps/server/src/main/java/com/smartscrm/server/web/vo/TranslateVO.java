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
    String cacheKey
) {
}
