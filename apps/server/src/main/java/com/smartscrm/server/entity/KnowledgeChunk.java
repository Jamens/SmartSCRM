package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B28 文档分片。{@code derived=1} 表示该片已被人工确认/派生过。 */
@Data
@TableName("knowledge_chunk")
public class KnowledgeChunk {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long docId;
    /** 分片序号，从 0 起。 */
    private Integer seq;
    private String content;
    private Integer charCount;
    /** 1=已被人工确认/派生过。 */
    private Integer derived;
    private LocalDateTime createdAt;
}
