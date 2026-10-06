package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B21 云账号池 · 分组。v1 只存记录，云账号经 {@code group_id} 挂靠；未分组的号 {@code group_id} 为空。
 */
@Data
@TableName("cloud_account_group")
public class CloudAccountGroup {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 分组名。 */
    private String name;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
