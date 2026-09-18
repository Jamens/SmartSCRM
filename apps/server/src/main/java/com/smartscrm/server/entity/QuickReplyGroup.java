package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("quick_reply_group")
public class QuickReplyGroup {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private Integer sort;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
