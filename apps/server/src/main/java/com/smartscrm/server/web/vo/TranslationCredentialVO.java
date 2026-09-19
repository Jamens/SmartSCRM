package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/** Masked credential view: the secret itself is never serialized. */
public record TranslationCredentialVO(
    String provider,
    String appId,
    boolean hasSecret,
    String region,
    LocalDateTime updatedAt
) {
}
