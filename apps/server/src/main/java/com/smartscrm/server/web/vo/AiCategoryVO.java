package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.AiCategory;
import java.time.LocalDateTime;

public record AiCategoryVO(Long id, String name, Integer sort, LocalDateTime createdAt) {
    public static AiCategoryVO of(AiCategory c) {
        return new AiCategoryVO(c.getId(), c.getName(), c.getSort(), c.getCreatedAt());
    }
}
