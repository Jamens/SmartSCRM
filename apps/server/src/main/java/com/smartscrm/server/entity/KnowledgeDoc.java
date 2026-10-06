package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 知识库文档。存上传的原始正文，解析后切分成 {@link KnowledgeChunk}。
 * {@code status} 走 parsing→ready/failed，disabled 表示停用（不参与检索与派生、保留行供恢复）。
 */
@Data
@TableName("knowledge_doc")
public class KnowledgeDoc {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    /** text | file | url（本期只做 text/file）。 */
    private String sourceType;
    /** 原始正文。 */
    private String content;
    /** parsing | ready | failed | disabled。 */
    private String status;
    private Integer charCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
