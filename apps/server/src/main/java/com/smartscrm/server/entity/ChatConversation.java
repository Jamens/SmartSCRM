package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("chat_conversation")
public class ChatConversation {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String title;
    private Integer isGroup;
    private Long customerId;
    private LocalDateTime lastMsgTime;
    private String lastMsgBody;
    private Integer unreadCount;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;

    /** B28 P1: AI / WAITING_TAKEOVER / HUMAN_ACTIVE。默认 AI。 */
    private String handlingStatus;
    /** 接管坐席 = app_user.id；AI / WAITING_TAKEOVER 态为 NULL。 */
    private Long assigneeId;
    /** 前向钩子：AI 人设引擎（B28 延后子特性）的实例 id，当前逻辑不消费。 */
    private Long aiPersonaId;
    /** B28 第四段：AI 检索出的建议答案。坐席在接管台确认后才会真的发出去。 */
    private String aiSuggestion;
    /** 建议的置信度（余弦相似度 0~1）；坐席据此判断该不该用。 */
    private Float aiSuggestionScore;
    /** 建议对应的知识库 QA id，便于坐席回溯出处。 */
    private Long aiSuggestionQaId;
    /** 进入 WAITING_TAKEOVER 的时间，供队列按等待时长排序。 */
    private LocalDateTime waitTakeoverAt;
    /** 转人工原因（规则触发或坐席手动转人工时填写）。 */
    private String transferReason;

    /** upsertHead 的入参：本次要加的未读数（0 或 1），不落库。 */
    @TableField(exist = false)
    private Integer unreadDelta;
}
