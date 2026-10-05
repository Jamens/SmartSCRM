package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * A10 消息中心 — 站内通知。
 *
 * <p>一条通知属于一个租户；{@code userId} 为 {@code null} 表示广播给租户全员。
 * 已读状态**不**存在本表上，而是按用户记在 {@link NotificationRead}，所以一条广播
 * 通知对不同子账号各读各的。可见性 = {@code userId = 当前用户 OR userId IS NULL}。
 */
@Data
@TableName("notification")
public class Notification {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 目标用户；{@code null} = 租户全员广播。 */
    private Long userId;
    /** "system"（系统通知）或 "user"。 */
    private String type;
    private String title;
    private String content;
    /** 点击跳转的前端路由，如 {@code /messages}。 */
    private String link;
    private LocalDateTime createdAt;

    /**
     * 当前查看者是否已读——由 NotificationService 按 {@link NotificationRead} 填充，
     * 不是表里的列（{@code exist = false} 让 MyBatis-Plus 忽略它）。
     */
    @TableField(exist = false)
    private Boolean read;
}

