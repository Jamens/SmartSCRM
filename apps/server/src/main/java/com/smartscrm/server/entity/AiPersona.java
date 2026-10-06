package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 AI 人设。挂在 {@code ai_role} 上（roleId 可空=不绑定）；{@code chat_conversation.ai_persona_id}
 * （V16 留的 deferred hook）指向它。{@code tone} 是语气标签，助手据此套模板产草稿。
 */
@Data
@TableName("ai_persona")
public class AiPersona {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long roleId;
    private String name;
    /** 语气标签（助手据此套模板）。 */
    private String tone;
    /** 系统提示词正文。 */
    private String prompt;
    /** 从哪个模板生成，如 friendly/pro。 */
    private String template;
    /** 0 停用, 1 启用。 */
    private Integer enabled;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
