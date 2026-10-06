package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.AiRole;
import java.time.LocalDateTime;

public record AiRoleVO(Long id, String name, String prompt, Boolean enabled, Integer sort, LocalDateTime createdAt) {
    public static AiRoleVO of(AiRole r) {
        return new AiRoleVO(r.getId(), r.getName(), r.getPrompt(),
            r.getEnabled() != null && r.getEnabled() == 1, r.getSort(), r.getCreatedAt());
    }
}
