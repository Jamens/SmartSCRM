package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatConversation;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface ChatConversationMapper extends BaseMapper<ChatConversation> {

    /**
     * 会话头是投影：随消息写入，且只在时间更新时改写摘要，乱序到达的旧消息不会
     * 把会话顶到列表前面。unread 增量由调用方算好（0 或 1），这里不判定活跃会话。
     */
    @Insert("INSERT INTO chat_conversation (tenant_id, account_id, platform, chat_key, title, is_group,"
        + " customer_id, last_msg_time, last_msg_body, unread_count) VALUES (#{tenantId}, #{accountId},"
        + " #{platform}, #{chatKey}, #{title}, #{isGroup}, #{customerId}, #{lastMsgTime}, #{lastMsgBody},"
        + " #{unreadDelta}) ON DUPLICATE KEY UPDATE"
        + " title = IF(VALUES(title) IS NULL, title, VALUES(title)),"
        + " customer_id = COALESCE(customer_id, VALUES(customer_id)),"
        + " last_msg_time = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     VALUES(last_msg_time), last_msg_time),"
        + " last_msg_body = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     VALUES(last_msg_body), last_msg_body),"
        + " unread_count = unread_count + #{unreadDelta}")
    int upsertHead(ChatConversation head);

    @Update("UPDATE chat_conversation SET unread_count = 0 WHERE id = #{id} AND tenant_id = #{tenantId}")
    int clearUnread(@Param("tenantId") Long tenantId, @Param("id") Long id);

    /** 运维兜底：会话头按消息重算（spec §3「错乱可由重算接口修复」）。 */
    @Update("UPDATE chat_conversation c SET last_msg_time ="
        + " (SELECT MAX(m.msg_time) FROM chat_message m WHERE m.tenant_id = c.tenant_id"
        + "   AND m.account_id = c.account_id AND m.chat_key = c.chat_key),"
        + " last_msg_body = (SELECT COALESCE(m.body, m.media_summary) FROM chat_message m"
        + "   WHERE m.tenant_id = c.tenant_id AND m.account_id = c.account_id AND m.chat_key = c.chat_key"
        + "   ORDER BY m.msg_time DESC, m.id DESC LIMIT 1)"
        + " WHERE c.id = #{id} AND c.tenant_id = #{tenantId}")
    int replayHead(@Param("tenantId") Long tenantId, @Param("id") Long id);
}
