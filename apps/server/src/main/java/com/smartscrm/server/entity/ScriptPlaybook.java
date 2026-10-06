package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B8 炒群引擎 · 剧本（绑定角色 + loop 间隔 + 有序账号列表=failover 顺序）。 */
@Data
@TableName("script_playbook")
public class ScriptPlaybook {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long roleId;
    private String name;
    private Integer enabled;
    /** loop 间隔（秒）。 */
    private Integer loopIntervalSec;
    /** 有序账号列表（JSON 数组文本）= failover 顺序。 */
    private String accountIds;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
