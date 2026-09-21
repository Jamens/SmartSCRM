package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.ChatMessage;
import java.time.LocalDateTime;
import java.util.Comparator;

public record MessageVO(
    Long id, Long accountId, String platform, String chatKey, String msgKey, String direction,
    Long customerId, String senderKey, String senderName, String body, String mediaType,
    String mediaSummary, LocalDateTime msgTime, String status, String source, String sendLocalId
) {

    /**
     * 消息的正序：先 msgTime，同一时刻再按 id 递增。DATETIME(3) 允许同一毫秒两条，只按时间排
     * 是不稳定序；而键集游标（Cursors）就是按 (time, id) 这一对定序的，所以读出来的顺序必须
     * 与翻页口径一致，否则时间线/记录页与上一页之间会出现同一毫秒的兄弟行交错。
     */
    public static final Comparator<MessageVO> CHRONOLOGICAL = (a, b) -> a.msgTime().isEqual(b.msgTime())
        ? Long.compare(a.id(), b.id())
        : a.msgTime().compareTo(b.msgTime());

    public static MessageVO of(ChatMessage m) {
        return new MessageVO(m.getId(), m.getAccountId(), m.getPlatform(), m.getChatKey(), m.getMsgKey(),
            m.getDirection(), m.getCustomerId(), m.getSenderKey(), m.getSenderName(), m.getBody(),
            m.getMediaType(), m.getMediaSummary(), m.getMsgTime(), m.getStatus(), m.getSource(),
            m.getSendLocalId());
    }
}
