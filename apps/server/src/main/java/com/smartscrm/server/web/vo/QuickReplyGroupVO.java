package com.smartscrm.server.web.vo;

public record QuickReplyGroupVO(
    Long id,
    String name,
    Integer sort,
    long replyCount
) {
}
