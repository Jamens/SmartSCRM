package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * A8 敏感词风控 — 租户本地敏感词。
 *
 * <p>{@code word} 在租户内唯一；{@code enabled=0} 的词不参与命中。
 * {@code category} 只是可选分组标签，命中逻辑不依赖它。
 */
@Data
@TableName("sensitive_word")
public class SensitiveWord {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String word;
    private String category;
    /** 0 不参与命中, 1 参与。 */
    private Integer enabled;
    private LocalDateTime createdAt;
}
