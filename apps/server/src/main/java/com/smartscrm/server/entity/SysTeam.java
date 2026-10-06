package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** Admin team. Nested via parentId, and scoped like roles: null tenant is platform-wide. */
@Data
@TableName("sys_team")
public class SysTeam {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long parentId;
    private String name;
    private Long leaderId;
    private Integer scope;
    /** 1 = NORMAL, 2 = DC. Defaults to NORMAL on insert. */
    @TableField("type")
    private Integer type;
    /** 1 = push tickets to this department, 0 = not. Defaults to 0. */
    @TableField("is_push_ticket")
    private Integer isPushTicket;
    /** Department permission string (comma-separated); nullable. */
    @TableField("powers")
    private String powers;
    private Integer status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
