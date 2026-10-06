package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.KnowledgeChunk;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.KnowledgeChunkMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 知识库 QA（租户隔离）。手写（{@code source=manual}）与分片派生（{@code derived}）共用本表；
 * 派生来源 {@code docId/chunkId} 由文档管线那条链路写入，本类只提供手写入口与通用 CRUD。
 * {@code status=0} 停用不参与检索与派生。
 */
@Service
public class KnowledgeQaService {

    private static final String SRC_MANUAL = "manual";
    private static final String SRC_DERIVED = "derived";

    private final KnowledgeQaMapper mapper;
    private final KnowledgeChunkMapper chunkMapper;

    public KnowledgeQaService(KnowledgeQaMapper mapper, KnowledgeChunkMapper chunkMapper) {
        this.mapper = mapper;
        this.chunkMapper = chunkMapper;
    }

    public List<KnowledgeQa> list(Long tenantId, Long roleId, Long categoryId, Integer status) {
        return mapper.selectList(new LambdaQueryWrapper<KnowledgeQa>()
            .eq(KnowledgeQa::getTenantId, tenantId)
            .eq(roleId != null, KnowledgeQa::getRoleId, roleId)
            .eq(categoryId != null, KnowledgeQa::getCategoryId, categoryId)
            .eq(status != null, KnowledgeQa::getStatus, status)
            .orderByDesc(KnowledgeQa::getId));
    }

    /** 手写建一条 QA（source 固定 manual，派生来源为空）。 */
    @Transactional
    public KnowledgeQa create(Long tenantId, Long roleId, Long categoryId, String question, String answer, Integer status) {
        KnowledgeQa q = new KnowledgeQa();
        q.setTenantId(tenantId);
        q.setRoleId(roleId);
        q.setCategoryId(categoryId);
        q.setQuestion(requireText(question, "question"));
        q.setAnswer(requireText(answer, "answer"));
        q.setSource(SRC_MANUAL);
        q.setStatus(status == null ? 1 : (status == 0 ? 0 : 1));
        mapper.insert(q);
        return q;
    }

    @Transactional
    public KnowledgeQa update(Long tenantId, Long id, Long roleId, Long categoryId,
                              String question, String answer, Integer status) {
        KnowledgeQa q = get(tenantId, id);
        if (roleId != null) q.setRoleId(roleId);
        if (categoryId != null) q.setCategoryId(categoryId);
        if (question != null && !question.isBlank()) q.setQuestion(question.trim());
        if (answer != null && !answer.isBlank()) q.setAnswer(answer.trim());
        if (status != null) q.setStatus(status == 0 ? 0 : 1);
        mapper.updateById(q);
        return q;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        mapper.deleteById(get(tenantId, id).getId());
    }

    /**
     * 人工确认后把**某个分片派生出的候选**落库（source=derived，锚回 docId/chunkId）。
     * 分片归属校验：chunk 必须属于本租户（防跨租户引用他人文档的分片）。
     */
    @Transactional
    public KnowledgeQa createDerived(Long tenantId, Long chunkId, Long roleId, Long categoryId,
                                      String question, String answer) {
        KnowledgeChunk chunk = chunkMapper.selectById(chunkId);
        if (chunk == null || !tenantId.equals(chunk.getTenantId())) {
            throw new BizException(40404, "分片不存在: " + chunkId);
        }
        KnowledgeQa q = new KnowledgeQa();
        q.setTenantId(tenantId);
        q.setRoleId(roleId);
        q.setCategoryId(categoryId);
        q.setQuestion(requireText(question, "question"));
        q.setAnswer(requireText(answer, "answer"));
        q.setSource(SRC_DERIVED);
        q.setDocId(chunk.getDocId());
        q.setChunkId(chunk.getId());
        q.setStatus(1);
        mapper.insert(q);
        // 标记该分片已被人工确认/派生过
        chunk.setDerived(1);
        chunkMapper.updateById(chunk);
        return q;
    }

    private KnowledgeQa get(Long tenantId, Long id) {
        KnowledgeQa q = mapper.selectById(id);
        if (q == null || !tenantId.equals(q.getTenantId())) {
            throw new BizException(40404, "QA 不存在: " + id);
        }
        return q;
    }

    private static String requireText(String v, String field) {
        if (v == null || v.isBlank()) {
            throw new BizException(40000, field + " 不能为空");
        }
        return v.trim();
    }
}
