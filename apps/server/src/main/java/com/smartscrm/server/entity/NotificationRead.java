package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * A10 消息中心 — 通知已读（按用户）。
 *
 * <p>存在即已读；{@code (notification_id, user_id)} 唯一，重复标记走 insert-ignore 语义。
 * 一条通知被某用户读过一次后，对该用户就不再计入未读。
 */
@Data
@TableName("notification_read")
public class NotificationRead {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long notificationId;
    private Long userId;
    private LocalDateTime readAt;
}
