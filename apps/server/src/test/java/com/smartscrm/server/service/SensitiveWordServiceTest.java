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
import com.smartscrm.server.entity.SensitiveWord;
import com.smartscrm.server.mapper.SensitiveWordMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SensitiveWordServiceTest {

    private static final Long TENANT = 1L;

    private SensitiveWordMapper mapper;
    private SensitiveWordService service;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), SensitiveWord.class);
        mapper = mock(SensitiveWordMapper.class);
        service = new SensitiveWordService(mapper);
    }

    private static SensitiveWord word(String w, Integer enabled) {
        SensitiveWord s = new SensitiveWord();
        s.setWord(w);
        s.setEnabled(enabled);
        return s;
    }

    // ============ 命中（纯逻辑） ============

    @Test
    void matchWords_isCaseInsensitiveSubstring() {
        var hits = SensitiveWordService.matchWords("这里有 Fraud 内容", List.of(word("fraud", 1)));
        assertEquals(List.of("fraud"), hits);
    }

    @Test
    void matchWords_ignoresDisabled() {
        var hits = SensitiveWordService.matchWords("有 bad 词", List.of(word("bad", 0)));
        assertTrue(hits.isEmpty());
    }

    @Test
    void matchWords_returnsOriginalCasing_notLowercased() {
        var hits = SensitiveWordService.matchWords("这里是 Loan", List.of(word("Loan", 1)));
        assertEquals(List.of("Loan"), hits);
    }

    @Test
    void matchWords_dedupes() {
        var hits = SensitiveWordService.matchWords("risk risk risk", List.of(word("risk", 1), word("risk", 1)));
        assertEquals(1, hits.size());
    }

    @Test
    void matchWords_emptyTextOrEmptyList() {
        assertTrue(SensitiveWordService.matchWords("", List.of(word("x", 1))).isEmpty());
        assertTrue(SensitiveWordService.matchWords("abc", List.of()).isEmpty());
        assertTrue(SensitiveWordService.matchWords(null, List.of(word("x", 1))).isEmpty());
    }

    @Test
    void matchWords_skipsBlankWordEntries() {
        var hits = SensitiveWordService.matchWords("abc", List.of(word("  ", 1), word("b", 1)));
        assertEquals(List.of("b"), hits);
    }

    // ============ create ============

    @Test
    void create_trimsWordAndDefaultsEnabled() {
        when(mapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        service.create(TENANT, "  spam  ", "  广告 ");
        ArgumentCaptor<SensitiveWord> cap = ArgumentCaptor.forClass(SensitiveWord.class);
        verify(mapper).insert(cap.capture());
        assertEquals("spam", cap.getValue().getWord());
        assertEquals("广告", cap.getValue().getCategory());
        assertEquals(1, cap.getValue().getEnabled());
    }

    @Test
    void create_rejectsBlankWord() {
        assertThrows(BizException.class, () -> service.create(TENANT, "   ", null));
        verify(mapper, never()).insert(any(SensitiveWord.class));
    }

    @Test
    void create_rejectsDuplicate() {
        when(mapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        assertThrows(BizException.class, () -> service.create(TENANT, "dup", null));
        verify(mapper, never()).insert(any(SensitiveWord.class));
    }

    // ============ setEnabled / delete 租户隔离 ============

    @Test
    void setEnabled_otherTenantIsNotFound() {
        SensitiveWord w = word("x", 1);
        w.setId(9L);
        w.setTenantId(999L);
        when(mapper.selectById(9L)).thenReturn(w);
        assertThrows(BizException.class, () -> service.setEnabled(TENANT, 9L, false));
    }

    @Test
    void delete_otherTenantIsNotFound() {
        SensitiveWord w = word("x", 1);
        w.setId(9L);
        w.setTenantId(999L);
        when(mapper.selectById(9L)).thenReturn(w);
        assertThrows(BizException.class, () -> service.delete(TENANT, 9L));
        verify(mapper, never()).deleteById(any(Long.class));
    }
}
