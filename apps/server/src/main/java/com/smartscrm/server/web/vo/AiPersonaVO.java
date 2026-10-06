package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.AiPersona;
import java.time.LocalDateTime;

public record AiPersonaVO(Long id, Long roleId, String name, String tone, String prompt, String template,
                          Boolean enabled, LocalDateTime createdAt) {
    public static AiPersonaVO of(AiPersona p) {
        return new AiPersonaVO(p.getId(), p.getRoleId(), p.getName(), p.getTone(), p.getPrompt(), p.getTemplate(),
            p.getEnabled() != null && p.getEnabled() == 1, p.getCreatedAt());
    }
}
