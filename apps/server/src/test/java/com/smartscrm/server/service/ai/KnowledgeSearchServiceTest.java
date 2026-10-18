package com.smartscrm.server.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiRole;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.entity.KnowledgeQaEmbedding;
import com.smartscrm.server.mapper.AiRoleMapper;
import com.smartscrm.server.mapper.KnowledgeQaEmbeddingMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * B28 知识库向量检索 service 单测。
 *
 * <p>embedding 端点用 mock 隔离：本类要测的是「召回口径」——租户隔离、停用不召回、
 * 角色停用不召回、阈值过滤、排序、topK、维度不符跳过、脏向量跳过；
 * 端点本身的行为属于集成范畴，由 EmbeddingClient 自己的解析逻辑保证。
 */
class KnowledgeSearchServiceTest {

    private static final Long TENANT = 1L;
    private static final String MODEL = "nomic-embed-text";

    private KnowledgeQaMapper qaMapper;
    private KnowledgeQaEmbeddingMapper embeddingMapper;
    private AiRoleMapper roleMapper;
    private EmbeddingClient client;
    private KnowledgeSearchService service;

    @BeforeEach
    void setUp() {
        // 纯单测无 Spring 上下文：手工注册 TableInfo，wrapper 才能解析列名
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, KnowledgeQa.class);
        TableInfoHelper.initTableInfo(asst, KnowledgeQaEmbedding.class);
        TableInfoHelper.initTableInfo(asst, AiRole.class);
        qaMapper = mock(KnowledgeQaMapper.class);
        embeddingMapper = mock(KnowledgeQaEmbeddingMapper.class);
        roleMapper = mock(AiRoleMapper.class);
        client = mock(EmbeddingClient.class);
        when(client.enabled()).thenReturn(true);
        when(client.model()).thenReturn(MODEL);
        service = new KnowledgeSearchService(qaMapper, embeddingMapper, roleMapper, client);
    }

    private static KnowledgeQa qa(Long id, Long roleId, Integer status) {
        KnowledgeQa q = new KnowledgeQa();
        q.setId(id);
        q.setTenantId(TENANT);
        q.setRoleId(roleId);
        q.setStatus(status);
        q.setQuestion("Q" + id);
        q.setAnswer("A" + id);
        return q;
    }

    private static KnowledgeQaEmbedding vec(Long qaId, String json) {
        KnowledgeQaEmbedding e = new KnowledgeQaEmbedding();
        e.setTenantId(TENANT);
        e.setQaId(qaId);
        e.setModel(MODEL);
        e.setVector(json);
        return e;
    }

    private void stubQueryVector(float[] v) {
        List<Float> qv = new java.util.ArrayList<>();
        for (float f : v) {
            qv.add(f);
        }
        when(client.embed(any())).thenReturn(qv);
    }

    // ===== 相似度与阈值 =====

    @Test
    void cosine_identicalVectorsScoreOne() {
        assertEquals(1.0f, KnowledgeSearchService.cosine(List.of(1f, 2f, 3f), List.of(1f, 2f, 3f)), 1e-6);
    }

    @Test
    void cosine_orthogonalIsZero_zeroVectorIsZero() {
        assertEquals(0f, KnowledgeSearchService.cosine(List.of(1f, 0f), List.of(0f, 1f)), 1e-6);
        // 零向量不产生除零，直接判不相关
        assertEquals(0f, KnowledgeSearchService.cosine(List.of(0f, 0f), List.of(1f, 1f)), 1e-6);
    }

    @Test
    void search_returnsHitsSortedByScoreDesc() {
        stubQueryVector(new float[] {1f, 0f});
        // 两条同向：完全一致应得 1.0，另一条部分重合得较低分
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[0.7,0.7]")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, null, 1)));

        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "怎么退货", 5, 0f, null, null);

        assertEquals(2, hits.size());
        assertTrue(hits.get(0).score() >= hits.get(1).score(), "应按分数降序");
        assertEquals(1L, hits.get(0).qa().getId(), "最相近的应排最前");
    }

    @Test
    void search_filtersBelowThreshold() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[-1.0,0.0]")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, null, 1)));

        // 反向向量得分为负，过阈值后应只剩一条
        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "q", 5, 0.5f, null, null);
        assertEquals(1, hits.size());
        assertEquals(1L, hits.get(0).qa().getId());
    }

    @Test
    void search_respectsTopK() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[0.9,0.1]"), vec(3L, "[0.8,0.2]")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, null, 1), qa(3L, null, 1)));

        assertEquals(2, service.search(TENANT, "q", 2, 0f, null, null).size());
    }

    // ===== 召回口径：停用 / 角色 / 维度 / 脏数据 =====

    @Test
    void search_skipsQaNotReturnedAsCandidate() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[1.0,0.0]")));
        // QA 查询侧只回 1 条（2 号被 status=0 或分类/租户条件滤掉）
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1)));

        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "q", 5, 0f, null, null);
        assertEquals(1, hits.size());
        assertEquals(1L, hits.get(0).qa().getId());
    }

    @Test
    void search_skipsQaBoundToDisabledRole() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[1.0,0.0]")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, 77L, 1)));
        // 角色 77 未启用 → 绑定它的 QA 不参与
        when(roleMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());

        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "q", 5, 0f, null, null);
        assertEquals(1, hits.size());
        assertEquals(1L, hits.get(0).qa().getId());
    }

    @Test
    void search_keepsQaBoundToEnabledRole() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, 77L, 1)));
        AiRole role = new AiRole();
        role.setId(77L);
        role.setTenantId(TENANT);
        role.setEnabled(1);
        when(roleMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(role));

        assertEquals(1, service.search(TENANT, "q", 5, 0f, null, null).size());
    }

    @Test
    void search_skipsMismatchedDimensionAndDirtyVector() {
        stubQueryVector(new float[] {1f, 0f });
        // 2 号维度对不上，3 号是脏数据，都应跳过而不中断整次检索
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[1.0,0.0,0.0]"), vec(3L, "not-json")));
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, null, 1), qa(3L, null, 1)));

        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "q", 5, 0f, null, null);
        assertEquals(1, hits.size());
        assertEquals(1L, hits.get(0).qa().getId());
    }

    @Test
    void search_roleIdFilterKeepsUnboundAndMatchingRole() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(vec(1L, "[1.0,0.0]"), vec(2L, "[1.0,0.0]"), vec(3L, "[1.0,0.0]")));
        // 1 号未绑定角色、2 号绑定 77、3 号绑定 88；指定 roleId=77 时应命中 1 和 2
        when(qaMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(qa(1L, null, 1), qa(2L, 77L, 1), qa(3L, 88L, 1)));
        AiRole role = new AiRole();
        role.setId(77L);
        role.setTenantId(TENANT);
        role.setEnabled(1);
        when(roleMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(role));

        List<KnowledgeSearchService.Hit> hits = service.search(TENANT, "q", 5, 0f, 77L, null);
        assertEquals(2, hits.size());
    }

    // ===== 前置条件与降级 =====

    @Test
    void search_rejectsBlankQuery() {
        assertThrows(BizException.class, () -> service.search(TENANT, "  ", 5, 0.35f, null, null));
        verify(client, never()).embed(any());
    }

    @Test
    void search_throwsWhenEmbeddingNotConfigured() {
        when(client.enabled()).thenReturn(false);
        // 端点未配置必须显式报错，不能静默返回空列表让人误判为「库里没匹配」
        BizException e = assertThrows(BizException.class,
            () -> service.search(TENANT, "q", 5, 0.35f, null, null));
        assertEquals(40905, e.getCode());
    }

    @Test
    void search_returnsEmptyWhenNoVectorsYet() {
        stubQueryVector(new float[] {1f, 0f});
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
        assertTrue(service.search(TENANT, "q", 5, 0.35f, null, null).isEmpty());
    }

    // ===== 建索引 =====

    @Test
    void buildIndex_skipsUnchangedEntries() {
        KnowledgeQa q = qa(1L, null, 1);
        when(qaMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(q));
        KnowledgeQaEmbedding existing = vec(1L, "[1.0,0.0]");
        // 用同一个文本算出的 hash 冒充「未变更」
        existing.setContentHash(KnowledgeSearchService.sha256("Q1\nA1"));
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(existing));

        assertEquals(0, service.buildIndex(TENANT), "内容与模型都没变应跳过重算");
        verify(client, never()).embedBatch(anyList());
    }

    @Test
    void buildIndex_insertsNewVector() {
        when(qaMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(qa(1L, null, 1)));
        when(embeddingMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
        when(client.embedBatch(anyList())).thenReturn(List.of(List.of(0.1f, 0.2f)));

        assertEquals(1, service.buildIndex(TENANT));
        ArgumentCaptor<KnowledgeQaEmbedding> cap = ArgumentCaptor.forClass(KnowledgeQaEmbedding.class);
        verify(embeddingMapper).insert(cap.capture());
        assertEquals(TENANT, cap.getValue().getTenantId());
        assertEquals(1L, cap.getValue().getQaId());
        assertEquals(MODEL, cap.getValue().getModel());
        assertEquals(2, cap.getValue().getDim());
        assertEquals("[0.1,0.2]", cap.getValue().getVector());
    }

    @Test
    void buildIndex_throwsWhenEmbeddingNotConfigured() {
        when(client.enabled()).thenReturn(false);
        assertThrows(BizException.class, () -> service.buildIndex(TENANT));
    }

    @Test
    void buildIndex_returnsZeroWhenNoActiveQa() {
        when(qaMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
        assertEquals(0, service.buildIndex(TENANT));
        verify(client, never()).embedBatch(anyList());
    }
}
