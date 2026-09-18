package com.smartscrm.server.web.dto;

public record QuickReplyItemRequest(
    /** 1=text 2=image 3=business-card */
    Integer type,
    String content,
    Long materialId,
    String mediaUrl,
    String cardName,
    String cardPhone,
    Integer sort
) {
}
