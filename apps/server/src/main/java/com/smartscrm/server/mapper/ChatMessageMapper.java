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
     * 2026-09-20 一次性探针实测过这四种形态：单行新增 1、单行重复 0、两行里一条重复 1、
     * 两行全重复 0 —— 也就是整批调用给的是"插进去几行"，不是"整批成没成"。
     * 列清单含 {@code msg_id}（实体序里紧跟 {@code msg_key}）：spec §2/§4 要求采集即落
     * 平台消息 id，它是 {@link #findForTranslation} 等值支的规范键；缺了这列，新行只能靠
     * msg_key 尾部或 saveTranslation 的 COALESCE 懒填，"入库即有 msg_id"的前提就不成立。
     */
    @Insert({"<script>",
        "INSERT IGNORE INTO chat_message",
        "(tenant_id, account_id, platform, chat_key, msg_key, msg_id, direction, customer_id, sender_key, sender_name,",
        " body, media_type, media_summary, msg_time, status, source, send_local_id) VALUES",
        "<foreach collection='list' item='m' separator=','>",
        "(#{m.tenantId}, #{m.accountId}, #{m.platform}, #{m.chatKey}, #{m.msgKey}, #{m.msgId}, #{m.direction},",
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

    /**
     * 消息级译文回显的候选行：作用域用主进程盖的 tenant/account/chat_key，再用页给的 msgId 缩小。
     * msg_id 命中规范行（本计划采集链已写入）；msg_id 为空的老行靠 msg_key 尾部含 msgId 认出
     * （msg_key 序列化为 `<fromMe>_<chatKey>_<id.id>[_out]`，id.id 在尾部），命中后由 saveTranslation 懒填。
     * 这里只回判定要用的列，不回正文大字段。body 是否等于本次文本由调用方（服务层）归一化后比对，
     * 挡住错位/伪造的 msgId 命中到别人的行。
     * 调用方契约（Task 3 服务层把关，契约测试断言）：`msgId` 必须先形状校验为非空、可见 ASCII 的平台 id
     * ——空串会让 `msg_key LIKE '%'` 命中该会话的每一行，`%`/`_` 会放大匹配，都不可接受。
     * ORDER BY 让规范行（msg_id 已填）优先于靠 msg_key 尾部认出的老行：两条谓词同时成立时取确定的一行，
     * 不把译文写进行扫描顺序随机挑中的另一行。
     */
    @Select("SELECT id, body, msg_id, translated_body, translated_lang FROM chat_message"
        + " WHERE tenant_id = #{tenantId} AND account_id = #{accountId} AND chat_key = #{chatKey}"
        + " AND (msg_id = #{msgId} OR msg_key LIKE CONCAT('%', #{msgId}))"
        + " ORDER BY (msg_id = #{msgId}) DESC LIMIT 1")
    ChatMessage findForTranslation(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                                   @Param("chatKey") String chatKey, @Param("msgId") String msgId);

    /**
     * 成功译文回写定位到的那一行；只动 translated_* 与（仅当原来为空时）msg_id。
     * 降级/厂商失败不调用这里（服务层把关）。COALESCE 保证懒填只补空、不覆盖既有规范 id。
     */
    @Update("UPDATE chat_message SET translated_body = #{translatedBody}, translated_lang = #{translatedLang},"
        + " msg_id = COALESCE(msg_id, #{msgId}) WHERE id = #{id}")
    int saveTranslation(@Param("id") Long id, @Param("msgId") String msgId,
                        @Param("translatedBody") String translatedBody, @Param("translatedLang") String translatedLang);
}
