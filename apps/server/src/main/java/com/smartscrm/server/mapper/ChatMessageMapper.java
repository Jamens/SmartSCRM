package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatMessage;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface ChatMessageMapper extends BaseMapper<ChatMessage> {

    /**
     * 采集链的唯一写入口。uk_msg 命中即忽略：重复事件、补底与实时交叠、重挂后的
     * 尾巴重放，全都靠这一条消解，所以调用方不需要先查后插。
     * 返回值 = 真正插入的行数；duplicated = 提交条数 - 返回值。
     */
    @Insert({"<script>",
        "INSERT IGNORE INTO chat_message",
        "(tenant_id, account_id, platform, chat_key, msg_key, direction, customer_id, sender_key, sender_name,",
        " body, media_type, media_summary, msg_time, status, source, send_local_id) VALUES",
        "<foreach collection='list' item='m' separator=','>",
        "(#{m.tenantId}, #{m.accountId}, #{m.platform}, #{m.chatKey}, #{m.msgKey}, #{m.direction},",
        " #{m.customerId}, #{m.senderKey}, #{m.senderName}, #{m.body}, #{m.mediaType}, #{m.mediaSummary},",
        " #{m.msgTime}, #{m.status}, #{m.source}, #{m.sendLocalId})",
        "</foreach>",
        "</script>"})
    int insertIgnoreBatch(@Param("list") List<ChatMessage> list);

    /**
     * 发送状态的单调推进，一条 SQL 自己把关（不做"先查后改"，省一次往返也避免竞态）：
     * 出站行只能沿 pending→sent→delivered→read 往上走；failed 只能从 pending/sent 落定，
     * 落定即终态 —— 迟到的 ack 不能把一条已经失败的消息翻回成功，页面上它已经带重试按钮了。
     * 第一条分支显式要求 status 也在阶梯上：FIELD() 对清单外的值返回 0，
     * 只比大小会把 'failed'/'received'/脏值当成最低的一阶，让 0 < FIELD('sent') 成立而把它们顶上去。
     * 与页内 chatStatus.ts 的 canAdvance 同形（Task 7），两边必须一致。
     */
    @Update("UPDATE chat_message SET status = #{toStatus} WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey} AND msg_key = #{msgKey} AND direction = 'out'"
        + " AND ((#{toStatus} IN ('sent', 'delivered', 'read')"
        + "       AND status IN ('pending', 'sent', 'delivered', 'read')"
        + "       AND FIELD(status, 'pending', 'sent', 'delivered', 'read')"
        + "           < FIELD(#{toStatus}, 'pending', 'sent', 'delivered', 'read'))"
        + "      OR (#{toStatus} = 'failed' AND status IN ('pending', 'sent')))")
    int advanceStatus(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                      @Param("accountId") Long accountId, @Param("chatKey") String chatKey,
                      @Param("msgKey") String msgKey, @Param("toStatus") String toStatus);

    @Select("SELECT COUNT(*) total, COALESCE(SUM(direction = 'in'), 0) inCount,"
        + " COALESCE(SUM(direction = 'out'), 0) outCount,"
        + " COUNT(DISTINCT chat_key) activeConversations"
        + " FROM chat_message WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND msg_time >= #{from}")
    Map<String, Object> statsTotals(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                                    @Param("from") LocalDateTime from);

    /**
     * 按日计数。DATE_FORMAT 直接给字符串，省掉 java.sql.Date 的时区二义；
     * 没有消息的日子由服务层补零（统计卡的柱条数必须等于 days）。
     */
    @Select("SELECT DATE_FORMAT(msg_time, '%Y-%m-%d') day, COALESCE(SUM(direction = 'in'), 0) inCount,"
        + " COALESCE(SUM(direction = 'out'), 0) outCount"
        + " FROM chat_message WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND msg_time >= #{from} GROUP BY day ORDER BY day")
    List<Map<String, Object>> statsPerDay(@Param("tenantId") Long tenantId,
                                          @Param("accountId") Long accountId,
                                          @Param("from") LocalDateTime from);
}
