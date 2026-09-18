package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("platform_account")
public class PlatformAccount {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Integer platformType;
    private String name;
    private String phone;
    private String avatar;
    private String viewId;
    private Integer status;
    private String remark;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
