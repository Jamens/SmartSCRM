package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B19 待踢成员明细（一人一行）。canRemove=0 → 执行时标 skipped 不硬踢（防踢超管）。 */
@Data
@TableName("group_kick_item")
public class GroupKickItem {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long taskId;
    private String participantId;
    private String displayName;
    /** 命中哪条规则。 */
    private String reason;
    /** pending|removing|removed|failed|skipped。 */
    private String status;
    /** canRemove 结果；0=不可踢。 */
    private Integer canRemove;
    private String errorDetail;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
