package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B18 加群任务。{@code status} 复用 batch-send 词表，但多一个 {@code confirmed} 态——
 * 它是**人工门**（spec §5）：只有 confirmed 能进执行链。
 */
@Data
@TableName("group_join_task")
public class GroupJoinTask {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 用哪个号加群。 */
    private Long accountId;
    private String name;
    /** pending|confirmed|running|done|error|cancelled（confirmed = 人工门已过）。 */
    private String status;
    private Integer intervalMinSec;
    private Integer intervalMaxSec;
    /** 抖动百分比，防固定间隔风控指纹。 */
    private Integer jitterPct;
    private Integer total;
    private Integer succeeded;
    private Integer failed;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
