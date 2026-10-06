package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 AI 角色（知识库三栏之一）。人设提示词挂在角色上（{@code prompt}），
 * {@code enabled=0} 的角色不参与。租户内 {@code name} 唯一。
 */
@Data
@TableName("ai_role")
public class AiRole {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    /** 人设提示词，喂 AI 人设引擎。 */
    private String prompt;
    /** 0 停用不参与, 1 参与。 */
    private Integer enabled;
    private Integer sort;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
