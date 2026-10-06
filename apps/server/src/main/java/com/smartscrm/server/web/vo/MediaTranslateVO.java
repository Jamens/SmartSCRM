package com.smartscrm.server.web.vo;

public record MediaTranslateVO(
    /** OCR/ASR 从媒体抽取出的原文（尚未翻译）。 */
    String extractedText,
    String translation,
    boolean cached,
    boolean partial,
    boolean containsChinese,
    String type,
    String channel,
    String fromLangCode,
    String toLangCode,
    String cacheKey,
    /** True when the OCR/ASR or the following text translate fell back to the local engine. */
    boolean degraded,
    String degradeReason,
    String scope,
    boolean degradeRetryable
) {
}
