package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B18 加群明细（一码一行，断点粒度）。uk(task_id, invite_code) 幂等。 */
@Data
@TableName("group_join_item")
public class GroupJoinItem {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long taskId;
    /** 邀请码——wa-js join() 的唯一入参。 */
    private String inviteCode;
    /** join 后回填。 */
    private String groupId;
    /** 预览（getGroupInfoFromInviteCode）回填。 */
    private String groupName;
    /** pending|joining|joined|failed|skipped。 */
    private String status;
    private String errorDetail;
    private String msgKey;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
