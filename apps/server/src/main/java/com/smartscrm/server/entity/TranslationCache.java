package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_cache")
public class TranslationCache {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String cacheKey;
    private String type;
    private String channel;
    private String fromLang;
    private String toLang;
    private String sourceText;
    private String targetText;
    private Boolean partial;
    private Integer hitCount;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
