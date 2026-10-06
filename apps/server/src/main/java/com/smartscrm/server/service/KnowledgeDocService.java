package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.KnowledgeChunk;
import com.smartscrm.server.entity.KnowledgeDoc;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.KnowledgeChunkMapper;
import com.smartscrm.server.mapper.KnowledgeDocMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 知识库文档管线（租户隔离）。文档存原始正文，{@link #parse} 按空行切分成
 * {@link KnowledgeChunk} 落库。**派生 QA 不在这里自动落库**（spec §8）——分片只作为
 * 预览素材，候选由渲染层 {@code deriveQaPreview} 产出、人工确认后才 POST /knowledge-qa。
 */
@Service
public class KnowledgeDocService {

    /** 单片目标上限（字符）：切分时按块贪心装箱，超过就开新片。 */
    static final int MAX_CHUNK_CHARS = 800;

    private final KnowledgeDocMapper docMapper;
    private final KnowledgeChunkMapper chunkMapper;
    private final KnowledgeQaMapper qaMapper;

    public KnowledgeDocService(KnowledgeDocMapper docMapper, KnowledgeChunkMapper chunkMapper, KnowledgeQaMapper qaMapper) {
        this.docMapper = docMapper;
        this.chunkMapper = chunkMapper;
        this.qaMapper = qaMapper;
    }

    public List<KnowledgeDoc> list(Long tenantId) {
        return docMapper.selectList(new LambdaQueryWrapper<KnowledgeDoc>()
            .eq(KnowledgeDoc::getTenantId, tenantId)
            .orderByDesc(KnowledgeDoc::getUpdatedAt).orderByDesc(KnowledgeDoc::getId));
    }

    public KnowledgeDoc get(Long tenantId, Long id) {
        KnowledgeDoc d = docMapper.selectById(id);
        if (d == null || !tenantId.equals(d.getTenantId())) {
            throw new BizException(40404, "文档不存在: " + id);
        }
        return d;
    }

    /** 上传文档并存正文，随即同步解析切成片（status=ready）。 */
    @Transactional
    public KnowledgeDoc create(Long tenantId, String name, String sourceType, String content) {
        String n = requireName(name);
        String c = content == null ? "" : content;
        KnowledgeDoc d = new KnowledgeDoc();
        d.setTenantId(tenantId);
        d.setName(n);
        d.setSourceType(sourceType == null || sourceType.isBlank() ? "text" : sourceType);
        d.setContent(c);
        d.setCharCount(c.length());
        d.setStatus("parsing");
        docMapper.insert(d);
        return parseInternal(tenantId, d);
    }

    /** 重新解析：清掉旧片、按当前正文重切（重解析入口）。 */
    @Transactional
    public KnowledgeDoc parse(Long tenantId, Long id) {
        return parseInternal(tenantId, get(tenantId, id));
    }

    /** 停用：保留行与片，但不参与检索与派生（可再 parse 恢复）。 */
    @Transactional
    public KnowledgeDoc disable(Long tenantId, Long id) {
        KnowledgeDoc d = get(tenantId, id);
        d.setStatus("disabled");
        docMapper.updateById(d);
        return d;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        KnowledgeDoc d = get(tenantId, id);
        // 删除文档前先把「由本文档派生的 QA」的来源指针抹掉(doc_id/chunk_id→null)：
        // 派生 QA 是**人工确认过的独立知识**，不该因为删了源文档就被销毁(那是破坏性且反直觉)；
        // 但留着 chunk_id 又会变成指向已删分片的悬空引用。抹掉指针、QA 独立存活——既不丢数据也不留脏引用。
        qaMapper.update(null, new LambdaUpdateWrapper<KnowledgeQa>()
            .eq(KnowledgeQa::getTenantId, tenantId)
            .eq(KnowledgeQa::getDocId, d.getId())
            .set(KnowledgeQa::getDocId, null)
            .set(KnowledgeQa::getChunkId, null));
        chunkMapper.delete(new LambdaQueryWrapper<KnowledgeChunk>()
            .eq(KnowledgeChunk::getDocId, d.getId()).eq(KnowledgeChunk::getTenantId, tenantId));
        docMapper.deleteById(d.getId());
    }

    public List<KnowledgeChunk> listChunks(Long tenantId, Long docId) {
        get(tenantId, docId); // 校验归属
        return chunkMapper.selectList(new LambdaQueryWrapper<KnowledgeChunk>()
            .eq(KnowledgeChunk::getTenantId, tenantId)
            .eq(KnowledgeChunk::getDocId, docId)
            .orderByAsc(KnowledgeChunk::getSeq));
    }

    // ============ 内部 ============

    private KnowledgeDoc parseInternal(Long tenantId, KnowledgeDoc d) {
        chunkMapper.delete(new LambdaQueryWrapper<KnowledgeChunk>()
            .eq(KnowledgeChunk::getDocId, d.getId()).eq(KnowledgeChunk::getTenantId, tenantId));
        List<String> chunks = splitChunks(d.getContent());
        int seq = 0;
        for (String c : chunks) {
            KnowledgeChunk k = new KnowledgeChunk();
            k.setTenantId(tenantId);
            k.setDocId(d.getId());
            k.setSeq(seq++);
            k.setContent(c);
            k.setCharCount(c.length());
            k.setDerived(0);
            chunkMapper.insert(k);
        }
        d.setStatus("ready");
        d.setCharCount(d.getContent() == null ? 0 : d.getContent().length());
        docMapper.updateById(d);
        return d;
    }

    /**
     * 切分纯逻辑（无 DB，可单测）：按**空行**切块，再按 {@link #MAX_CHUNK_CHARS} 贪心装箱
     * （一块超限也自成一片，不硬切单词——保住块的完整性，交给人工看预览）。
     */
    static List<String> splitChunks(String content) {
        List<String> out = new ArrayList<>();
        if (content == null || content.isBlank()) {
            return out;
        }
        String[] blocks = content.replace("\r", "").split("\n\\s*\n");
        StringBuilder cur = new StringBuilder();
        for (String raw : blocks) {
            String b = raw.trim();
            if (b.isEmpty()) continue;
            if (cur.length() > 0 && cur.length() + b.length() + 2 > MAX_CHUNK_CHARS) {
                out.add(cur.toString());
                cur.setLength(0);
            }
            if (cur.length() > 0) cur.append("\n\n");
            cur.append(b);
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "name 不能为空");
        }
        return name.trim();
    }
}
