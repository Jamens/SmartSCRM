package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.entity.TranslationPhrase;
import com.smartscrm.server.mapper.TranslationPhraseMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * In-memory view of `translation_phrase`: lang code -> (phrase key -> text).
 * Loaded once per process; the dictionary is seed data, so it never changes at runtime.
 */
@Component
public class PhraseDict {

    /** The eight languages the simulated engine can actually produce. */
    public static final List<String> SUPPORTED = List.of("zh-CN", "en", "vi", "id", "lo", "hi", "my", "ms");

    private final TranslationPhraseMapper phraseMapper;
    private volatile Map<String, Map<String, String>> index;

    public PhraseDict(TranslationPhraseMapper phraseMapper) {
        this.phraseMapper = phraseMapper;
    }

    private PhraseDict(Map<String, Map<String, String>> index) {
        this.phraseMapper = null;
        this.index = index;
    }

    public static PhraseDict of(Map<String, Map<String, String>> index) {
        return new PhraseDict(index);
    }

    public Map<String, String> byLang(String lang) {
        if (lang == null) {
            return Map.of();
        }
        return load().getOrDefault(lang, Map.of());
    }

    public boolean supports(String lang) {
        return lang != null && !byLang(lang).isEmpty();
    }

    private Map<String, Map<String, String>> load() {
        Map<String, Map<String, String>> current = index;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (index != null) {
                return index;
            }
            Map<String, Map<String, String>> built = new LinkedHashMap<>();
            List<TranslationPhrase> rows = phraseMapper.selectList(new LambdaQueryWrapper<TranslationPhrase>()
                .orderByAsc(TranslationPhrase::getLangCode)
                .orderByAsc(TranslationPhrase::getId));
            for (TranslationPhrase row : rows) {
                built.computeIfAbsent(row.getLangCode(), k -> new LinkedHashMap<>())
                    .put(row.getPhraseKey(), row.getText());
            }
            index = built;
            return built;
        }
    }
}
