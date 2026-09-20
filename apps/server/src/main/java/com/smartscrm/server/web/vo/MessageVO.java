package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.ChatMessage;
import java.time.LocalDateTime;

public record MessageVO(
    Long id, Long accountId, String platform, String chatKey, String msgKey, String direction,
    Long customerId, String senderKey, String senderName, String body, String mediaType,
    String mediaSummary, LocalDateTime msgTime, String status, String source, String sendLocalId
) {

    public static MessageVO of(ChatMessage m) {
        return new MessageVO(m.getId(), m.getAccountId(), m.getPlatform(), m.getChatKey(), m.getMsgKey(),
            m.getDirection(), m.getCustomerId(), m.getSenderKey(), m.getSenderName(), m.getBody(),
            m.getMediaType(), m.getMediaSummary(), m.getMsgTime(), m.getStatus(), m.getSource(),
            m.getSendLocalId());
    }
}
