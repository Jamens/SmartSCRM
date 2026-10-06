package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B8 炒群引擎 · 剧本角色库·角色（如 素人种草/专业测评）。租户内 (category,name) 唯一。 */
@Data
@TableName("script_role")
public class ScriptRole {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long categoryId;
    private String name;
    /** 人设提示词。 */
    private String prompt;
    private Integer enabled;
    private Integer sort;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
