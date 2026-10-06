package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B8 炒群引擎 · 剧本角色库·动作模板（挂在角色下；动作词表见 shared/scriptActions.ts）。 */
@Data
@TableName("script_action_tpl")
public class ScriptActionTpl {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long roleId;
    /** 动作类型，见 shared/scriptActions.ts 词表。 */
    private String actionType;
    private String name;
    /** 话术引用/数量等参数（JSON 文本）。 */
    private String params;
    private Integer enabled;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
