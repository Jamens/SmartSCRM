package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.CustomerAudience;
import java.util.List;

public record AudienceVO(
    Long id,
    String name,
    Integer platformType,
    String keyword,
    List<Long> tagIds,
    long customerCount,
    java.time.LocalDateTime createdAt
) {

    public static AudienceVO of(CustomerAudience a, List<Long> tagIds, long customerCount) {
        return new AudienceVO(
            a.getId(), a.getName(), a.getPlatformType(), a.getKeyword(),
            tagIds, customerCount, a.getCreatedAt());
    }
}
