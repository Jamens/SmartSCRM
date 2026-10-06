package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B8 炒群引擎 · 任务实例（对某个群跑某剧本）。
 *
 * <p>{@code currentStep} 是**断点**（failover 切号不重置它）；{@code status} 与 batch-send
 * 同一条词表；{@code uk(tenant,playbook,target_chat_key)} 保证 loop 反复扫不会给同一群重复建任务。
 */
@Data
@TableName("script_task")
public class ScriptTask {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long playbookId;
    /** 当前主账号。 */
    private Long accountId;
    private String targetChatKey;
    private String targetGroupId;
    /** pending|running|paused|done|error|cancelled（与 batch-send 同词表）。 */
    private String status;
    /** 断点：当前到第几步。 */
    private Integer currentStep;
    /** failover 计数。 */
    private Integer attempts;
    private String lastError;
    /** loop 下次触发。 */
    private LocalDateTime nextRunAt;
    private LocalDateTime heartbeatAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
