package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("quick_reply")
public class QuickReply {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long groupId;
    private String title;
    private String shortcut;
    private Integer sort;
    private Integer useCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
