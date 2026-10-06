package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.KnowledgeChunk;

public record KnowledgeChunkVO(Long id, Long docId, Integer seq, String content, Integer charCount, Boolean derived) {
    public static KnowledgeChunkVO of(KnowledgeChunk k) {
        return new KnowledgeChunkVO(k.getId(), k.getDocId(), k.getSeq(), k.getContent(), k.getCharCount(),
            k.getDerived() != null && k.getDerived() == 1);
    }
}
