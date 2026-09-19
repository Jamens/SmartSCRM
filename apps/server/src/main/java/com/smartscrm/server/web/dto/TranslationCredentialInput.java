package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Write-only credential form. A blank secretKey keeps the stored secret untouched,
 * so appid/region can be edited without re-pasting the key. Secrets are never
 * returned by any endpoint (GET responds with a hasSecret flag only).
 */
public record TranslationCredentialInput(
    @NotBlank(message = "provider 不能为空") String provider,
    @NotBlank(message = "appId 不能为空") @Size(max = 64, message = "appId 最长 64 字符") String appId,
    @Size(max = 255, message = "secretKey 最长 255 字符") String secretKey,
    @Size(max = 32, message = "region 最长 32 字符") String region
) {
}
