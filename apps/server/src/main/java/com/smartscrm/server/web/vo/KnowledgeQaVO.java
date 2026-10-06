package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.KnowledgeQa;
import java.time.LocalDateTime;

public record KnowledgeQaVO(Long id, Long roleId, Long categoryId, String question, String answer,
                            String source, Boolean status, LocalDateTime createdAt) {
    public static KnowledgeQaVO of(KnowledgeQa q) {
        return new KnowledgeQaVO(q.getId(), q.getRoleId(), q.getCategoryId(), q.getQuestion(), q.getAnswer(),
            q.getSource(), q.getStatus() != null && q.getStatus() == 1, q.getCreatedAt());
    }
}
