package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B28 知识库 QA 的向量表示（检索用）。一条 {@link KnowledgeQa} 对应一条向量。
 *
 * <p>{@code model} + {@code dim} 一起判定可比性：换 embedding 模型后维度可能变化，
 * 旧向量与新查询向量不同空间，必须重算而不能混用。{@code contentHash} 是被向量化
 * 文本的 sha256，用于识别内容变更后的脏向量。
 */
@Data
@TableName("knowledge_qa_embedding")
public class KnowledgeQaEmbedding {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long qaId;
    /** embedding 模型标识，换模型时旧数据失效。 */
    private String model;
    /** 向量维度；与 model 一起判定可比性。 */
    private Integer dim;
    /** float 数组的 JSON 文本，如 {@code [0.012,-0.34]}。 */
    private String vector;
    /** 被向量化文本的 sha256；内容变了要重算。 */
    private String contentHash;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
