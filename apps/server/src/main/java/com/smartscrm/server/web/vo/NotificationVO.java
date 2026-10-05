package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.Notification;
import java.time.LocalDateTime;

/** A10 消息中心 — 列表行。`read` 是"当前查看者已读"，不是表列，由 Service 填充。 */
public record NotificationVO(
    Long id,
    String type,
    String title,
    String content,
    String link,
    Boolean read,
    LocalDateTime createdAt) {

    public static NotificationVO of(Notification n) {
        return new NotificationVO(
            n.getId(), n.getType(), n.getTitle(), n.getContent(), n.getLink(),
            n.getRead() != null && n.getRead(), n.getCreatedAt());
    }
}
