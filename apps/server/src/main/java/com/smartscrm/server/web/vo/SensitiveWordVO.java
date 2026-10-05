package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.SensitiveWord;
import java.time.LocalDateTime;

public record SensitiveWordVO(
    Long id,
    String word,
    String category,
    Boolean enabled,
    LocalDateTime createdAt) {

    public static SensitiveWordVO of(SensitiveWord w) {
        return new SensitiveWordVO(
            w.getId(), w.getWord(), w.getCategory(),
            w.getEnabled() != null && w.getEnabled() == 1, w.getCreatedAt());
    }
}
