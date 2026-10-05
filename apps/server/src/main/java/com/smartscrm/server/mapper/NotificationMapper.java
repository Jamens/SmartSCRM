package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.Notification;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface NotificationMapper extends BaseMapper<Notification> {

    /**
     * 未读数 = 租户内可见（发给本人或全员）且我没有已读行的通知条数。
     * 用 NOT EXISTS 而不是 LEFT JOIN + COUNT(DISTINCT)，语义直接对应"可见减已读"。
     */
    @Select("""
        SELECT COUNT(*) FROM notification n
        WHERE n.tenant_id = #{tenantId}
          AND (n.user_id = #{userId} OR n.user_id IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM notification_read r
            WHERE r.notification_id = n.id AND r.user_id = #{userId}
          )
        """)
    long countUnread(@Param("tenantId") Long tenantId, @Param("userId") Long userId);

    /** 可见且未读的通知 id（"全部已读"要据此批量写已读行）。 */
    @Select("""
        SELECT n.id FROM notification n
        WHERE n.tenant_id = #{tenantId}
          AND (n.user_id = #{userId} OR n.user_id IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM notification_read r
            WHERE r.notification_id = n.id AND r.user_id = #{userId}
          )
        """)
    List<Long> selectVisibleUnreadIds(@Param("tenantId") Long tenantId, @Param("userId") Long userId);
}
