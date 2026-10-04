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
    /** B17 P3：type=5（按钮）时的按钮载荷 JSON；其余类型为 null。 */
    String buttonPayload,
    /** B17 P1：public / personal / contact。 */
    String ownerScope,
    /** personal 时是拥有者 app_user.id，contact 时是 customer.id，public 时为 null。 */
    String ownerKey,
    LocalDateTime createdAt
) {

    public static MaterialVO of(Material m) {
        return new MaterialVO(m.getId(), m.getGroupId(), m.getType(), m.getName(), m.getUrl(),
            m.getMimeType(), m.getSizeBytes(), m.getRemark(),
            m.getButtonPayload(), m.getOwnerScope(), m.getOwnerKey(), m.getCreatedAt());
    }
}
