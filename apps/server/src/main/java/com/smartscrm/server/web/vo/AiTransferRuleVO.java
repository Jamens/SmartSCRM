package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.AiTransferRule;
import java.time.LocalDateTime;

/** B28 P2 — rule projection returned by the management API (entity is never serialized directly). */
public record AiTransferRuleVO(Long id, Long tenantId, String ruleName, String matchMode, String keywords,
                              String transferReason, Integer enabled, Integer priority, LocalDateTime createdAt,
                              LocalDateTime updatedAt) {

    public static AiTransferRuleVO of(AiTransferRule r) {
        return new AiTransferRuleVO(r.getId(), r.getTenantId(), r.getRuleName(), r.getMatchMode(),
            r.getKeywords(), r.getTransferReason(), r.getEnabled(), r.getPriority(),
            r.getCreatedAt(), r.getUpdatedAt());
    }
}
