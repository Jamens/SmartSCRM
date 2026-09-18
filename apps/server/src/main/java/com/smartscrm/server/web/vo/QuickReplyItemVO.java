package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.QuickReplyItem;

public record QuickReplyItemVO(
    Long id,
    Integer type,
    String content,
    Long materialId,
    String mediaUrl,
    String cardName,
    String cardPhone,
    Integer sort
) {

    public static QuickReplyItemVO of(QuickReplyItem item) {
        return new QuickReplyItemVO(item.getId(), item.getType(), item.getContent(), item.getMaterialId(),
            item.getMediaUrl(), item.getCardName(), item.getCardPhone(), item.getSort());
    }
}
