package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("batch_send_task")
public class BatchSendTask {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private String platform;
    private Boolean dryRun;
    private String status;
    private String accountIds;   // JSON 数组字符串，由 BatchJson 读写
    private String contents;     // JSON 数组字符串
    private Integer msgIntervalMin;
    private Integer msgIntervalMax;
    private Integer chatIntervalMin;
    private Integer chatIntervalMax;
    private Integer totalCount;
    private Integer sentCount;
    private Integer failCount;
    private LocalDateTime heartbeatAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
