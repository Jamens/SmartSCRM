package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatConversation;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface ChatConversationMapper extends BaseMapper<ChatConversation> {

    /**
     * 会话头是投影：随消息写入，且只在时间更新时改写摘要，乱序到达的旧消息不会
     * 把会话顶到列表前面。unread 增量由调用方算好（0 或 1），这里不判定活跃会话。
     * <p>
     * 两个守卫都拿 VALUES(last_msg_time) 跟库里的旧 last_msg_time 比，所以
     * last_msg_body 的赋值必须排在 last_msg_time 之前：ON DUPLICATE KEY UPDATE 的
     * 赋值列表按从左到右求值，排到后面的那条会读到前面刚写进去的新值，
     * 时间一被先更新，摘要分支就变成 new &gt; new —— 恒为假，预览文字永远停在第一条消息。
     * <p>
     * last_msg_body 只有 512，而消息正文是 TEXT：入参和 VALUES(last_msg_body) 都显式
     * LEFT(..., 512) 截断。探针实测：严格模式下 INSERT ... ON DUPLICATE KEY UPDATE 会先校验
     * 插入值清单（"Data too long ... at row 1"），命中重复键才走赋值分支，所以只截赋值侧
     * 拦不住 1406 —— 一条长消息照样把 Task 3 的整批入库带走。两处都截才成立。
     */
    @Insert("INSERT INTO chat_conversation (tenant_id, account_id, platform, chat_key, title, is_group,"
        + " customer_id, last_msg_time, last_msg_body, unread_count) VALUES (#{tenantId}, #{accountId},"
        + " #{platform}, #{chatKey}, #{title}, #{isGroup}, #{customerId}, #{lastMsgTime},"
        + " LEFT(#{lastMsgBody}, 512), COALESCE(#{unreadDelta}, 0)) ON DUPLICATE KEY UPDATE"
        + " title = IF(VALUES(title) IS NULL, title, VALUES(title)),"
        + " customer_id = COALESCE(customer_id, VALUES(customer_id)),"
        + " last_msg_body = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     LEFT(VALUES(last_msg_body), 512), last_msg_body),"
        + " last_msg_time = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     VALUES(last_msg_time), last_msg_time),"
        + " unread_count = unread_count + COALESCE(#{unreadDelta}, 0)")
    int upsertHead(ChatConversation head);

    @Update("UPDATE chat_conversation SET unread_count = 0 WHERE id = #{id} AND tenant_id = #{tenantId}")
    int clearUnread(@Param("tenantId") Long tenantId, @Param("id") Long id);

    /** 运维兜底：会话头按消息重算（spec §3「错乱可由重算接口修复」）。摘要与 upsertHead 同样截到 512。 */
    @Update("UPDATE chat_conversation c SET last_msg_time ="
        + " (SELECT MAX(m.msg_time) FROM chat_message m WHERE m.tenant_id = c.tenant_id"
        + "   AND m.account_id = c.account_id AND m.chat_key = c.chat_key),"
        + " last_msg_body = LEFT((SELECT COALESCE(m.body, m.media_summary) FROM chat_message m"
        + "   WHERE m.tenant_id = c.tenant_id AND m.account_id = c.account_id AND m.chat_key = c.chat_key"
        + "   ORDER BY m.msg_time DESC, m.id DESC LIMIT 1), 512)"
        + " WHERE c.id = #{id} AND c.tenant_id = #{tenantId}")
    int replayHead(@Param("tenantId") Long tenantId, @Param("id") Long id);
}
