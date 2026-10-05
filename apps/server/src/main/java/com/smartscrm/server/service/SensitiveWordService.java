package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.SensitiveWord;
import com.smartscrm.server.mapper.SensitiveWordMapper;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A8 敏感词风控（租户本地库，租户隔离）。
 *
 * <p>管理：{@code list / create / setEnabled / delete}。命中：{@link #match} 扫启用中的词做
 * 不区分大小写的子串匹配——本仓风控只做「提醒/拦截前的判定」，具体动作（提示、拦截、记录）
 * 由调用方决定；发送/入站链真正接上来是后续各功能的事。
 */
@Service
public class SensitiveWordService {

    private final SensitiveWordMapper mapper;

    public SensitiveWordService(SensitiveWordMapper mapper) {
        this.mapper = mapper;
    }

    /** 全部词（启用与否都列，设置页要能看到并启停）。 */
    public List<SensitiveWord> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<SensitiveWord>()
            .eq(SensitiveWord::getTenantId, tenantId)
            .orderByAsc(SensitiveWord::getId));
    }

    @Transactional
    public SensitiveWord create(Long tenantId, String word, String category) {
        String w = normalize(word);
        if (w == null) {
            throw new BizException(40000, "word 不能为空");
        }
        boolean dup = mapper.selectCount(new LambdaQueryWrapper<SensitiveWord>()
            .eq(SensitiveWord::getTenantId, tenantId)
            .eq(SensitiveWord::getWord, w)) > 0;
        if (dup) {
            throw new BizException(40000, "敏感词已存在: " + w);
        }
        SensitiveWord sw = new SensitiveWord();
        sw.setTenantId(tenantId);
        sw.setWord(w);
        sw.setCategory(category == null || category.isBlank() ? null : category.trim());
        sw.setEnabled(1);
        mapper.insert(sw);
        return sw;
    }

    @Transactional
    public void setEnabled(Long tenantId, Long id, boolean enabled) {
        SensitiveWord existing = get(tenantId, id);
        existing.setEnabled(enabled ? 1 : 0);
        mapper.updateById(existing);
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        SensitiveWord existing = get(tenantId, id);
        mapper.deleteById(existing.getId());
    }

    /** 命中检测：返回 text 中命中的敏感词（保持词库顺序、去重、忽略大小写与首尾空白差异）。 */
    public List<String> match(Long tenantId, String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        List<SensitiveWord> enabled = mapper.selectList(new LambdaQueryWrapper<SensitiveWord>()
            .eq(SensitiveWord::getTenantId, tenantId)
            .eq(SensitiveWord::getEnabled, 1)
            .orderByAsc(SensitiveWord::getId));
        return matchWords(text, enabled);
    }

    /**
     * 纯命中逻辑（无 DB、无 Spring，可直接单测）：对每个启用词做不区分大小写的子串判断。
     * 空文本或空词表返回空；词按库里的原样返回（不是小写化后的），便于界面高亮。
     */
    static List<String> matchWords(String text, List<SensitiveWord> words) {
        if (text == null || text.isBlank() || words == null || words.isEmpty()) {
            return List.of();
        }
        String norm = text.toLowerCase(Locale.ROOT);
        return words.stream()
            .filter(w -> w != null && w.getWord() != null && !w.getWord().isBlank())
            .filter(w -> w.getEnabled() == null || w.getEnabled() == 1)
            .filter(w -> norm.contains(w.getWord().toLowerCase(Locale.ROOT)))
            .map(SensitiveWord::getWord)
            .distinct()
            .toList();
    }

    // ============ 内部 ============

    private SensitiveWord get(Long tenantId, Long id) {
        SensitiveWord w = mapper.selectById(id);
        if (w == null || !tenantId.equals(w.getTenantId())) {
            throw new BizException(40404, "敏感词不存在: " + id);
        }
        return w;
    }

    private static String normalize(String word) {
        if (word == null || word.isBlank()) {
            return null;
        }
        return word.trim();
    }
}
