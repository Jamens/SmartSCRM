package com.smartscrm.server.web.vo;

import java.util.List;

public record TranslationCacheStatsVO(long totalKeys, long totalHits, List<TranslationCacheEntryVO> top) {
}
