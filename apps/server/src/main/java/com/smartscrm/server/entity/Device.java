package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("device")
public class Device {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long appUserId;
    private String deviceId;
    private String profileId;
    private String deviceName;
    private String osVersion;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
