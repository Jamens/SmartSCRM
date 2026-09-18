package com.smartscrm.server.web.vo;

public record TranslationNodeVO(Long id, String name, String label, String url, Integer baseDelayMs, Boolean reachable) {
}
