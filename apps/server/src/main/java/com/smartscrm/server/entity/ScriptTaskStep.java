package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B8 炒群引擎 · 任务步骤（断点续跑的粒度=每步一行）。
 *
 * <p>{@code status}：pending|sending|success|failed|skipped。恢复时只补 pending，
 * success 的步不重跑（否则重跑已完成步=发重复消息）。
 */
@Data
@TableName("script_task_step")
public class ScriptTaskStep {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long taskId;
    private Integer seq;
    private String actionType;
    /** pending|sending|success|failed|skipped。 */
    private String status;
    private String errorCode;
    private String errorDetail;
    private String msgKey;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
