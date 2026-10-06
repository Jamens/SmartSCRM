package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B8 炒群引擎 · 剧本步骤（线性有序；uk(playbook_id,seq) 防重序）。 */
@Data
@TableName("script_playbook_step")
public class ScriptPlaybookStep {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long playbookId;
    /** 步骤序号。 */
    private Integer seq;
    private String actionType;
    /** 参数（JSON 文本）。 */
    private String params;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
