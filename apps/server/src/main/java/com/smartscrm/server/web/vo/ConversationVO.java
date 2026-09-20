package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.ChatConversation;
import java.time.LocalDateTime;

public record ConversationVO(
    Long id, Long accountId, String platform, String chatKey, String title, Boolean isGroup,
    Long customerId, LocalDateTime lastMsgTime, String lastMsgBody, Integer unreadCount
) {

    public static ConversationVO of(ChatConversation c) {
        return new ConversationVO(c.getId(), c.getAccountId(), c.getPlatform(), c.getChatKey(), c.getTitle(),
            c.getIsGroup() != null && c.getIsGroup() == 1, c.getCustomerId(), c.getLastMsgTime(),
            c.getLastMsgBody(), c.getUnreadCount());
    }
}
