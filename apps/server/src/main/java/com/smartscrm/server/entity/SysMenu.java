package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;

/**
 * Admin menu node. Doubles as the permission source: every node carries a stable
 * {@code code}, and {@code type = 3} nodes are buttons that stay out of the sidebar
 * but are referenced by backend {@code @PreAuthorize} checks.
 */
@TableName("sys_menu")
public class SysMenu {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long parentId;
    private String name;
    private String code;
    private Integer type;
    private String path;
    private String icon;
    private Integer sort;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public Long getParentId() { return parentId; }
    public String getName() { return name; }
    public String getCode() { return code; }
    public Integer getType() { return type; }
    public String getPath() { return path; }
    public String getIcon() { return icon; }
    public Integer getSort() { return sort; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
