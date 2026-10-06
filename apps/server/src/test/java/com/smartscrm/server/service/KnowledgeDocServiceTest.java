package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.KnowledgeChunk;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.KnowledgeChunkMapper;
import com.smartscrm.server.mapper.KnowledgeDocMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B28 文档管线单测：切分纯逻辑 + 派生 QA 落库/跨租户拒绝。 */
class KnowledgeDocServiceTest {

    private static final Long TENANT = 1L;

    private KnowledgeDocMapper docMapper;
    private KnowledgeChunkMapper chunkMapper;
    private KnowledgeQaMapper qaMapper;
    private KnowledgeDocService docService;
    private KnowledgeQaService qaService;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, com.smartscrm.server.entity.KnowledgeDoc.class);
        TableInfoHelper.initTableInfo(asst, KnowledgeChunk.class);
        TableInfoHelper.initTableInfo(asst, KnowledgeQa.class);
        docMapper = mock(KnowledgeDocMapper.class);
        chunkMapper = mock(KnowledgeChunkMapper.class);
        qaMapper = mock(KnowledgeQaMapper.class);
        docService = new KnowledgeDocService(docMapper, chunkMapper, qaMapper);
        qaService = new KnowledgeQaService(qaMapper, chunkMapper);
    }

    // ===== 切分纯逻辑 =====

    @Test
    void splitChunks_packsSmallBlocksIntoOneChunk() {
        // 两个短块（各 < MAX）会被贪心装进同一片——"块"不等于"片"
        List<String> chunks = KnowledgeDocService.splitChunks("块一第一行\n块一第二行\n\n块二内容");
        assertEquals(1, chunks.size());
        assertTrue(chunks.get(0).contains("块一第一行"));
        assertTrue(chunks.get(0).contains("块二内容"));
    }

    @Test
    void splitChunks_emptyGivesNoChunks() {
        assertTrue(KnowledgeDocService.splitChunks(null).isEmpty());
        assertTrue(KnowledgeDocService.splitChunks("  \n\n ").isEmpty());
    }

    @Test
    void splitChunks_packsUpToMaxChars() {
        // 造多个 400 字块 → 单片上限 800，应装箱成多片
        String block = "x".repeat(400);
        String content = String.join("\n\n", block, block, block, block);
        List<String> chunks = KnowledgeDocService.splitChunks(content);
        assertTrue(chunks.size() >= 2, "超上限应切成多片，实际=" + chunks.size());
        for (String c : chunks) {
            assertTrue(c.length() <= 800 + 400, "单片不应远超上限");
        }
    }

    // ===== 派生 QA =====

    @Test
    void createDerived_anchorsToChunkAndMarksDerived() {
        KnowledgeChunk chunk = new KnowledgeChunk();
        chunk.setId(7L);
        chunk.setDocId(3L);
        chunk.setTenantId(TENANT);
        chunk.setDerived(0);
        when(chunkMapper.selectById(7L)).thenReturn(chunk);

        qaService.createDerived(TENANT, 7L, null, null, "怎么退款？", "找客服");

        ArgumentCaptor<KnowledgeQa> cap = ArgumentCaptor.forClass(KnowledgeQa.class);
        verify(qaMapper).insert(cap.capture());
        assertEquals("derived", cap.getValue().getSource());
        assertEquals(3L, cap.getValue().getDocId());
        assertEquals(7L, cap.getValue().getChunkId());
        verify(chunkMapper).updateById(chunk);
        assertEquals(1, chunk.getDerived());
    }

    @Test
    void createDerived_otherTenantChunkIsNotFound() {
        KnowledgeChunk chunk = new KnowledgeChunk();
        chunk.setId(7L);
        chunk.setTenantId(999L);
        when(chunkMapper.selectById(7L)).thenReturn(chunk);
        assertThrows(BizException.class, () -> qaService.createDerived(TENANT, 7L, null, null, "问", "答"));
        verify(qaMapper, never()).insert(any(KnowledgeQa.class));
    }

    // ===== 删文档：抹掉派生 QA 的来源指针但保留 QA（不销毁已确认的知识、无悬空引用） =====

    @Test
    void deleteDoc_clearsDerivedQaProvenance_butKeepsQa() {
        com.smartscrm.server.entity.KnowledgeDoc doc = new com.smartscrm.server.entity.KnowledgeDoc();
        doc.setId(3L);
        doc.setTenantId(TENANT);
        when(docMapper.selectById(3L)).thenReturn(doc);

        docService.delete(TENANT, 3L);

        // 抹来源指针的 update 被调用（qaMapper.update），QA 行本身不被销毁
        verify(qaMapper).update(any(), any());
        verify(docMapper).deleteById(3L);
    }
}
