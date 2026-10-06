package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B8 炒群引擎 · 剧本角色库·品类（如 种草/测评/私域）。租户内 name 唯一。 */
@Data
@TableName("script_role_category")
public class ScriptRoleCategory {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private Integer sort;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
