package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * B28 P2 — request body for creating / updating an AI transfer-to-human rule.
 * {@code transferReason}, {@code enabled}, {@code priority} are optional: on update a
 * null value leaves the existing field untouched (except {@code transferReason}, which
 * is explicitly nullable and may be cleared).
 */
public record AiTransferRuleDTO(
    @NotBlank String ruleName,
    @NotBlank String matchMode,
    @NotBlank String keywords,
    String transferReason,
    Integer enabled,
    Integer priority
) {
}
