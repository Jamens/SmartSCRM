package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.Material;
import java.time.LocalDateTime;

public record MaterialVO(
    Long id,
    Long groupId,
    Integer type,
    String name,
    String url,
    String mimeType,
    Long sizeBytes,
    String remark,
    LocalDateTime createdAt
) {

    public static MaterialVO of(Material m) {
        return new MaterialVO(m.getId(), m.getGroupId(), m.getType(), m.getName(), m.getUrl(),
            m.getMimeType(), m.getSizeBytes(), m.getRemark(), m.getCreatedAt());
    }
}
