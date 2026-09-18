package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_node")
public class TranslationNode {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    private String label;
    private String url;
    private Integer baseDelayMs;
    private Boolean reachable;
    private Integer sort;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
