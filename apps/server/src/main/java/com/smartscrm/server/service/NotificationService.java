package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Notification;
import com.smartscrm.server.entity.NotificationRead;
import com.smartscrm.server.mapper.NotificationMapper;
import com.smartscrm.server.mapper.NotificationReadMapper;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A10 消息中心 — 站内通知（租户隔离 + 按用户已读）。
 *
 * <p>可见性：通知 {@code userId = 当前用户 OR userId IS NULL}（后者是租户全员广播）。
 * 未读 = 可见 且 当前用户在 {@link NotificationRead} 没有对应行。已读与"全部已读"只
 * 写 {@code notification_read}，不动通知本身——广播通知对每个子账号各读各的。
 *
 * <p>投递入口是 {@link #publish}：系统/业务侧产生一条通知时调用（{@code userId} 传
 * {@code null} 即广播给全员）。本类只负责存取与已读，不负责"何时该通知"。
 */
@Service
public class NotificationService {

    private final NotificationMapper mapper;
    private final NotificationReadMapper readMapper;

    public NotificationService(NotificationMapper mapper, NotificationReadMapper readMapper) {
        this.mapper = mapper;
        this.readMapper = readMapper;
    }

    /** 可见通知分页；每条带当前用户的已读标记。unreadOnly=true 时只回未读。 */
    public Page<Notification> page(Long tenantId, Long userId, long pageNo, long pageSize, boolean unreadOnly) {
        LambdaQueryWrapper<Notification> q = new LambdaQueryWrapper<Notification>()
            .eq(Notification::getTenantId, tenantId)
            .and(w -> w.eq(userId != null, Notification::getUserId, userId).or().isNull(Notification::getUserId));
        if (unreadOnly) {
            q.apply("NOT EXISTS (SELECT 1 FROM notification_read r WHERE r.notification_id = notification.id AND r.user_id = {0})", userId);
        }
        q.orderByDesc(Notification::getCreatedAt).orderByDesc(Notification::getId);

        Page<Notification> result = mapper.selectPage(new Page<>(pageNo, pageSize), q);
        fillReadFlags(tenantId, userId, result.getRecords());
        return result;
    }

    /** 当前用户未读数（nav 小红点）。 */
    public long unreadCount(Long tenantId, Long userId) {
        return mapper.countUnread(tenantId, userId);
    }

    /** 把当前页里"我已读"的 id 标到实体上（两次查询，避免 LEFT JOIN 与分页计数打架）。 */
    private void fillReadFlags(Long tenantId, Long userId, List<Notification> records) {
        if (records.isEmpty()) {
            return;
        }
        List<Long> ids = records.stream().map(Notification::getId).toList();
        Set<Long> readIds = readMapper.selectList(new LambdaQueryWrapper<NotificationRead>()
                .eq(NotificationRead::getTenantId, tenantId)
                .eq(NotificationRead::getUserId, userId)
                .in(NotificationRead::getNotificationId, ids))
            .stream().map(NotificationRead::getNotificationId).collect(Collectors.toSet());
        records.forEach(n -> n.setRead(readIds.contains(n.getId())));
    }

    /** 标记单条已读；重复标记是幂等的（已读则直接返回）。非可见通知按 404 处理。 */
    @Transactional
    public void markRead(Long tenantId, Long userId, Long notificationId) {
        Notification n = requireVisible(tenantId, userId, notificationId);
        if (alreadyRead(tenantId, userId, n.getId())) {
            return;
        }
        insertRead(tenantId, userId, n.getId());
    }

    /** 全部已读：给当前用户所有"可见且未读"的通知补已读行，返回新标记条数。 */
    @Transactional
    public int markAllRead(Long tenantId, Long userId) {
        List<Long> ids = mapper.selectVisibleUnreadIds(tenantId, userId);
        for (Long id : ids) {
            insertRead(tenantId, userId, id);
        }
        return ids.size();
    }

    /**
     * 投递一条通知。{@code userId} 为 {@code null} 表示广播给租户全员。
     * 这是系统/业务侧唯一的写入口——列表与已读都不产生新通知。
     */
    @Transactional
    public Notification publish(Long tenantId, String type, String title, String content, String link, Long userId) {
        if (title == null || title.isBlank()) {
            throw new BizException(40000, "title 不能为空");
        }
        Notification n = new Notification();
        n.setTenantId(tenantId);
        n.setUserId(userId);
        n.setType(type == null || type.isBlank() ? "system" : type);
        n.setTitle(title);
        n.setContent(content);
        n.setLink(link);
        mapper.insert(n);
        return n;
    }

    // ============ 内部 ============

    /** 取一条"对 userId 可见"的通知，否则 404（不泄露他人定向通知的存在）。 */
    private Notification requireVisible(Long tenantId, Long userId, Long notificationId) {
        Notification n = mapper.selectById(notificationId);
        boolean visible = n != null
            && tenantId.equals(n.getTenantId())
            && (userId.equals(n.getUserId()) || n.getUserId() == null);
        if (!visible) {
            throw new BizException(40404, "通知不存在: " + notificationId);
        }
        return n;
    }

    private boolean alreadyRead(Long tenantId, Long userId, Long notificationId) {
        return readMapper.selectCount(new LambdaQueryWrapper<NotificationRead>()
            .eq(NotificationRead::getTenantId, tenantId)
            .eq(NotificationRead::getUserId, userId)
            .eq(NotificationRead::getNotificationId, notificationId)) > 0;
    }

    private void insertRead(Long tenantId, Long userId, Long notificationId) {
        NotificationRead r = new NotificationRead();
        r.setTenantId(tenantId);
        r.setUserId(userId);
        r.setNotificationId(notificationId);
        readMapper.insert(r);
    }
}
