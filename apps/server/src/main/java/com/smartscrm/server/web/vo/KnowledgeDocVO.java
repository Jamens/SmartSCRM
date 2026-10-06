package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.KnowledgeDoc;
import java.time.LocalDateTime;

public record KnowledgeDocVO(Long id, String name, String sourceType, String status, Integer charCount,
                            Integer chunkCount, LocalDateTime createdAt, LocalDateTime updatedAt) {
    public static KnowledgeDocVO of(KnowledgeDoc d, int chunkCount) {
        return new KnowledgeDocVO(d.getId(), d.getName(), d.getSourceType(), d.getStatus(), d.getCharCount(),
            chunkCount, d.getCreatedAt(), d.getUpdatedAt());
    }
}
