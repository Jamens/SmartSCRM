package com.smartscrm.server.service.ai;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiRole;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.entity.KnowledgeQaEmbedding;
import com.smartscrm.server.mapper.AiRoleMapper;
import com.smartscrm.server.mapper.KnowledgeQaEmbeddingMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 知识库向量检索。补上 {@code KnowledgeQaService} 一直缺的「检索」这一段——
 * 那边只有 CRUD，知识库存得进、检索不出；这里负责建向量与召回。
 *
 * <p>口径：
 * <ul>
 *   <li>租户隔离：向量与 QA 双层都按 tenant_id 收口，不依赖调用方传对 id。
 *   <li>停用不召回：{@code knowledge_qa.status=0} 不参与；{@code ai_role.enabled=0}
 *       绑定的 QA 也不参与（角色停了，它的知识不该被引用）。未绑定角色的 QA（role_id 为空）始终参与。
 *   <li>阈值过滤：低于 {@code threshold} 的不返回，避免"硬凑一条不相干的"。
 *   <li>维度/模型可比性：向量按当前模型召回，换模型后旧向量自动失效（不混用不同空间的向量）。
 * </ul>
 *
 * <p>未配置 embedding 端点时 {@link #available()} 为 false，由控制器返回明确提示，
 * 不做「静默返回空列表」——那会让人误判成库里没有匹配项。
 */
@Service
public class KnowledgeSearchService {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeSearchService.class);
    /** 召回不足此分即视为无命中，由调用方按业务调。 */
    private static final float DEFAULT_THRESHOLD = 0.35f;
    private static final int DEFAULT_TOP_K = 5;
    private static final int MAX_TOP_K = 50;

    private final KnowledgeQaMapper qaMapper;
    private final KnowledgeQaEmbeddingMapper embeddingMapper;
    private final AiRoleMapper roleMapper;
    private final EmbeddingClient embeddingClient;

    public KnowledgeSearchService(KnowledgeQaMapper qaMapper,
                                 KnowledgeQaEmbeddingMapper embeddingMapper,
                                 AiRoleMapper roleMapper,
                                 EmbeddingClient embeddingClient) {
        this.qaMapper = qaMapper;
        this.embeddingMapper = embeddingMapper;
        this.roleMapper = roleMapper;
        this.embeddingClient = embeddingClient;
    }

    /** 一条召回结果：QA 原文 + 相似度分数（0~1，越大越相近）。 */
    public record Hit(KnowledgeQa qa, float score) {}

    /** 是否具备检索能力（embedding 端点已配置）。 */
    public boolean available() {
        return embeddingClient.enabled();
    }

    public String model() {
        return embeddingClient.model();
    }

    /**
     * 向量化检索。
     *
     * @param tenantId  租户
     * @param query     用户提问
     * @param topK      返回条数，null 取默认 5；上限 50
     * @param threshold 相似度下限，null 取默认 0.35
     * @param roleId    可选，只召回绑定该角色（空值）或未绑定角色的 QA
     * @param categoryId 可选，只召回该分类下的 QA
     */
    public List<Hit> search(Long tenantId, String query, Integer topK, Float threshold,
                            Long roleId, Long categoryId) {
        if (query == null || query.isBlank()) {
            throw new BizException(40016, "检索内容不能为空");
        }
        if (!available()) {
            throw new BizException(40905,
                "知识库检索未启用：未配置 embedding 端点（scrm.embedding.base-url）");
        }
        int k = clampTopK(topK);
        float min = threshold == null ? DEFAULT_THRESHOLD : threshold;

        List<Float> queryVec = embeddingClient.embed(query);
        if (queryVec.isEmpty()) {
            return List.of();
        }

        // 只取本租户、当前模型下的向量；不同模型的旧向量不在这里参与
        List<KnowledgeQaEmbedding> rows = embeddingMapper.selectList(
            new LambdaQueryWrapper<KnowledgeQaEmbedding>()
                .eq(KnowledgeQaEmbedding::getTenantId, tenantId)
                .eq(KnowledgeQaEmbedding::getModel, embeddingClient.model()));
        if (rows.isEmpty()) {
            log.info("知识库检索：租户 {} 无可用向量，请先调用 buildIndex", tenantId);
            return List.of();
        }

        // 候选 QA 收口：启用 + 分类/角色过滤
        List<Long> candidateIds = new ArrayList<>();
        for (KnowledgeQaEmbedding row : rows) {
            candidateIds.add(row.getQaId());
        }
        // 复制一份再过滤：selectList 的返回不保证可变，就地 removeIf 会炸
        List<KnowledgeQa> candidates = new ArrayList<>(qaMapper.selectList(new LambdaQueryWrapper<KnowledgeQa>()
            .eq(KnowledgeQa::getTenantId, tenantId)
            .eq(KnowledgeQa::getStatus, 1)
            .in(KnowledgeQa::getId, candidateIds)
            .eq(categoryId != null, KnowledgeQa::getCategoryId, categoryId)));
        if (roleId != null) {
            // 指定角色：只取该角色，或未绑定角色的通用 QA
            candidates.removeIf(q -> q.getRoleId() != null && !roleId.equals(q.getRoleId()));
        }
        Map<Long, KnowledgeQa> qaById = new HashMap<>();
        for (KnowledgeQa q : candidates) {
            qaById.put(q.getId(), q);
        }

        List<Hit> hits = new ArrayList<>();
        // 角色启用集合只取一次，避免逐条候选重复查库
        Set<Long> enabledRoles = hasRoleBoundQa(candidates) ? enabledRoleIds(tenantId) : Set.of();
        for (KnowledgeQaEmbedding row : rows) {
            KnowledgeQa qa = qaById.get(row.getQaId());
            if (qa == null) {
                continue;
            }
            // 绑定了角色且该角色未启用 → 不参与检索
            if (qa.getRoleId() != null && !enabledRoles.contains(qa.getRoleId())) {
                continue;
            }
            List<Float> vec = parseVector(row.getVector());
            if (vec.isEmpty() || vec.size() != queryVec.size()) {
                continue;
            }
            float score = cosine(queryVec, vec);
            if (score >= min) {
                hits.add(new Hit(qa, score));
            }
        }
        // 分数降序；用 lambda 而非 Comparator.comparingFloat(Hit::score)，
        // 后者对 record 的组件方法做方法引用时类型推断会失败
        hits.sort((a, b) -> Float.compare(b.score(), a.score()));
        return hits.size() > k ? new ArrayList<>(hits.subList(0, k)) : hits;
    }

    /**
     * 建索引：把租户下启用中的 QA 向量化后落库。已存在且内容未变的跳过，换模型或内容变了的重算。
     *
     * @return 实际写入/更新的条数
     */
    @Transactional
    public int buildIndex(Long tenantId) {
        if (!available()) {
            throw new BizException(40905,
                "知识库索引构建未启用：未配置 embedding 端点（scrm.embedding.base-url）");
        }
        List<KnowledgeQa> qas = qaMapper.selectList(new LambdaQueryWrapper<KnowledgeQa>()
            .eq(KnowledgeQa::getTenantId, tenantId)
            .eq(KnowledgeQa::getStatus, 1));
        if (qas.isEmpty()) {
            return 0;
        }
        String model = embeddingClient.model();

        Map<Long, KnowledgeQaEmbedding> existing = new HashMap<>();
        for (KnowledgeQaEmbedding e : embeddingMapper.selectList(
                new LambdaQueryWrapper<KnowledgeQaEmbedding>()
                    .eq(KnowledgeQaEmbedding::getTenantId, tenantId))) {
            existing.put(e.getQaId(), e);
        }

        List<String> texts = new ArrayList<>();
        List<KnowledgeQa> pending = new ArrayList<>();
        for (KnowledgeQa q : qas) {
            String text = indexableText(q);
            if (text == null || text.isBlank()) {
                continue;
            }
            KnowledgeQaEmbedding old = existing.get(q.getId());
            if (old != null && model.equals(old.getModel())
                && sha256(text).equals(old.getContentHash())) {
                continue; // 模型与内容都没变，无需重算
            }
            texts.add(text);
            pending.add(q);
        }
        if (pending.isEmpty()) {
            return 0;
        }

        List<List<Float>> vectors = embeddingClient.embedBatch(texts);
        for (int i = 0; i < pending.size(); i++) {
            KnowledgeQa q = pending.get(i);
            List<Float> vec = vectors.get(i);
            if (vec == null || vec.isEmpty()) {
                continue;
            }
            KnowledgeQaEmbedding row = existing.get(q.getId());
            boolean isNew = row == null || !model.equals(row.getModel());
            if (isNew) {
                row = new KnowledgeQaEmbedding();
                row.setTenantId(tenantId);
                row.setQaId(q.getId());
            }
            row.setModel(model);
            row.setDim(vec.size());
            row.setVector(toJsonArray(vec));
            row.setContentHash(sha256(indexableText(q)));
            if (isNew) {
                embeddingMapper.insert(row);
            } else {
                embeddingMapper.updateById(row);
            }
        }
        log.info("知识库索引构建完成：租户 {} 处理 {} 条", tenantId, pending.size());
        return pending.size();
    }

    /** 被向量化文本：question 为主，附 answer 让「问法不同但答同一件事」也召得到。 */
    private static String indexableText(KnowledgeQa q) {
        String question = q.getQuestion() == null ? "" : q.getQuestion().trim();
        String answer = q.getAnswer() == null ? "" : q.getAnswer().trim();
        if (question.isBlank()) {
            return answer;
        }
        return answer.isBlank() ? question : question + "\n" + answer;
    }

    /** 候选里是否有绑定了角色的 QA；没有就不必查角色表。 */
    private static boolean hasRoleBoundQa(List<KnowledgeQa> candidates) {
        for (KnowledgeQa q : candidates) {
            if (q.getRoleId() != null) {
                return true;
            }
        }
        return false;
    }

    /** 取租户下启用中的角色 id。空集合代表没有任何启用角色。一次检索只查一次，避免逐条循环。 */
    private Set<Long> enabledRoleIds(Long tenantId) {
        Set<Long> ids = new HashSet<>();
        for (AiRole r : roleMapper.selectList(new LambdaQueryWrapper<AiRole>()
                .eq(AiRole::getTenantId, tenantId)
                .eq(AiRole::getEnabled, 1))) {
            ids.add(r.getId());
        }
        return ids;
    }

    /** 余弦相似度。零向量返回 0（视为不相关，不产生除零）。 */
    static float cosine(List<Float> a, List<Float> b) {
        double dot = 0;
        double na = 0;
        double nb = 0;
        int n = Math.min(a.size(), b.size());
        for (int i = 0; i < n; i++) {
            double x = a.get(i);
            double y = b.get(i);
            dot += x * y;
            na += x * x;
            nb += y * y;
        }
        if (na == 0 || nb == 0) {
            return 0f;
        }
        return (float) (dot / (Math.sqrt(na) * Math.sqrt(nb)));
    }

    static String toJsonArray(List<Float> vec) {
        StringBuilder sb = new StringBuilder(vec.size() * 8 + 2);
        sb.append('[');
        for (int i = 0; i < vec.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(vec.get(i));
        }
        return sb.append(']').toString();
    }

    /** 解析向量 JSON；脏数据不抛异常打断整批检索，返回空表示该条跳过。 */
    static List<Float> parseVector(String json) {
        List<Float> out = new ArrayList<>();
        if (json == null || json.isBlank()) {
            return out;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode arr =
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
            if (arr.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode n : arr) {
                    out.add((float) n.asDouble());
                }
            }
        } catch (Exception ignored) {
            // 脏向量跳过即可，不该让整次检索失败
        }
        return out;
    }

    static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256")
                .digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    private static int clampTopK(Integer topK) {
        int k = topK == null ? DEFAULT_TOP_K : topK;
        if (k <= 0) {
            return DEFAULT_TOP_K;
        }
        return Math.min(k, MAX_TOP_K);
    }
}
