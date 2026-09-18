package com.smartscrm.server.web.vo;

public record TranslationCacheEntryVO(String cacheKey, String sourceText, String targetText, Integer hitCount, Boolean partial) {
}
