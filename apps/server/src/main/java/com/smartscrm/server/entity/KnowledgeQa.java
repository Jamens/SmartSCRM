package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 知识库 QA 对（三栏之一）。可手写（{@code source=manual}）也可由文档分片派生
 * （{@code source=derived} 且 {@code docId}/{@code chunkId} 指向来源）。{@code roleId}/
 * {@code categoryId} 可空表示不绑定。{@code status=0} 停用不参与检索与派生。
 */
@Data
@TableName("knowledge_qa")
public class KnowledgeQa {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long roleId;
    private Long categoryId;
    private String question;
    private String answer;
    /** manual 手写 | derived 由分片派生。 */
    private String source;
    private Long docId;
    private Long chunkId;
    /** 0 停用不参与, 1 启用。 */
    private Integer status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
