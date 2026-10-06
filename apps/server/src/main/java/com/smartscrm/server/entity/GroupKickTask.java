package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B19 踢人任务。{@code approvalStatus} 是**人工门**，独立于 status：
 * 规则跑完出名单是 pending，人工审阅才 approved/rejected；执行链入口再判一次（spec §5）。
 */
@Data
@TableName("group_kick_task")
public class GroupKickTask {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 用哪个号踢（需该号在群里且是 admin）。 */
    private Long accountId;
    private String groupId;
    private String name;
    /** pending|running|done|error|cancelled。 */
    private String status;
    /** 人工门：pending|approved|rejected——approved 才能进执行链。 */
    private String approvalStatus;
    /** 规则快照（JSON 文本），规则会演进，存快照便于复现。 */
    private String rule;
    private Integer total;
    private Integer succeeded;
    private Integer failed;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
