package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * Admin role. {@code scope} decides whether the role is platform-wide or belongs to
 * one tenant; {@code builtin} marks seeded roles that must not be deleted.
 */
@Data
@TableName("sys_role")
public class SysRole {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private String code;
    private Integer scope;
    private Integer builtin;
    private Integer status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
