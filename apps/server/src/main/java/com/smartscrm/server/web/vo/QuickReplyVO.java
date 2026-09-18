package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;
import java.util.List;

public record QuickReplyVO(
    Long id,
    Long groupId,
    String title,
    String shortcut,
    Integer sort,
    Integer useCount,
    List<QuickReplyItemVO> items,
    LocalDateTime createdAt
) {

    public static QuickReplyVO of(com.smartscrm.server.entity.QuickReply reply, List<QuickReplyItemVO> items) {
        return new QuickReplyVO(reply.getId(), reply.getGroupId(), reply.getTitle(), reply.getShortcut(),
            reply.getSort(), reply.getUseCount(), items, reply.getCreatedAt());
    }
}
