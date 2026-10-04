package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiTransferRule;
import com.smartscrm.server.mapper.AiTransferRuleMapper;
import com.smartscrm.server.web.dto.AiTransferRuleDTO;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AiTransferRuleServiceTest {

    private AiTransferRuleMapper mapper;

    private AiTransferRuleService service;

    @BeforeEach
    void setUp() {
        // Pure unit test has no Spring context; register the entity's TableInfo manually so
        // LambdaQueryWrapper can resolve column names when firstMatch builds its wrapper.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), AiTransferRule.class);
        mapper = mock(AiTransferRuleMapper.class);
        service = new AiTransferRuleService(mapper);
    }

    // ============ evaluation ============

    @Test
    void firstMatch_returnsHighestPriorityRule() {
        AiTransferRule low = rule(1L, "low", "any", "hello", 0);
        AiTransferRule high = rule(2L, "high", "any", "urgent", 10);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(low, high));

        AiTransferRule matched = service.firstMatch(7L, "please urgent help");

        assertEquals(2L, matched.getId());
    }

    @Test
    void firstMatch_anyMode_hitsWhenOneKeywordPresent() {
        AiTransferRule rule = rule(1L, "r", "any", "退款,人工", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertEquals(1L, service.firstMatch(7L, "我要退款").getId());
    }

    @Test
    void firstMatch_allMode_requiresEveryKeyword() {
        AiTransferRule rule = rule(1L, "r", "all", "退款,投诉", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertNull(service.firstMatch(7L, "我要退款"));
        assertEquals(1L, service.firstMatch(7L, "我要退款并且投诉").getId());
    }

    @Test
    void firstMatch_blankBody_returnsNull() {
        AiTransferRule rule = rule(1L, "r", "any", "hi", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertNull(service.firstMatch(7L, "   "));
        assertNull(service.firstMatch(7L, null));
    }

    @Test
    void firstMatch_isCaseInsensitive() {
        AiTransferRule rule = rule(1L, "r", "any", "URGENT", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertEquals(1L, service.firstMatch(7L, "call me Urgent now").getId());
    }

    @Test
    void firstMatch_splitsChineseCommaAndTrims() {
        AiTransferRule rule = rule(1L, "r", "any", "人工， 客服 ", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertEquals(1L, service.firstMatch(7L, "转人工客服").getId());
    }

    @Test
    void firstMatch_noMatch_returnsNull() {
        AiTransferRule rule = rule(1L, "r", "any", "urgent", 0);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(rule));

        assertNull(service.firstMatch(7L, "just saying hello"));
    }

    // ============ CRUD + validation ============

    @Test
    void create_validatesMatchMode() {
        BizException ex = assertThrows(BizException.class,
            () -> service.create(7L, new AiTransferRuleDTO("r", "maybe", "kw", null, null, null)));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void create_validatesEmptyKeywords() {
        BizException ex = assertThrows(BizException.class,
            () -> service.create(7L, new AiTransferRuleDTO("r", "any", "  ,  ", null, null, null)));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void create_validatesBlankRuleName() {
        BizException ex = assertThrows(BizException.class,
            () -> service.create(7L, new AiTransferRuleDTO(" ", "any", "kw", null, null, null)));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void create_defaultsEnabledAndPriority_andNormalizes() {
        when(mapper.insert(any(AiTransferRule.class))).thenReturn(1);
        AiTransferRule created = service.create(7L, new AiTransferRuleDTO("r", "any", "kw1,kw2", "r:hot", null, null));
        assertEquals(1, created.getEnabled());
        assertEquals(0, created.getPriority());

        AiTransferRule explicit = service.create(7L, new AiTransferRuleDTO("r", "all", "kw", null, 0, 5));
        assertEquals(0, explicit.getEnabled());
        assertEquals(5, explicit.getPriority());

        // enabled=2 (non 0/1) clamps to 1
        AiTransferRule clamped = service.create(7L, new AiTransferRuleDTO("r", "any", "kw", null, 2, null));
        assertEquals(1, clamped.getEnabled());
    }

    @Test
    void get_enforcesTenantIsolation() {
        AiTransferRule foreign = rule(1L, "r", "any", "kw", 0);
        foreign.setTenantId(99L);
        when(mapper.selectById(1L)).thenReturn(foreign);

        BizException ex = assertThrows(BizException.class, () -> service.get(7L, 1L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void delete_enforcesTenantIsolation() {
        AiTransferRule foreign = rule(1L, "r", "any", "kw", 0);
        foreign.setTenantId(99L);
        when(mapper.selectById(1L)).thenReturn(foreign);

        BizException ex = assertThrows(BizException.class, () -> service.delete(7L, 1L));
        assertEquals(40404, ex.getCode());
        // deleteById 有 (Serializable) 与 (T) 两个重载，any() 会歧义；显式转成
        // Serializable 才与服务里 deleteById(Long) 解析到的那个重载对上。
        verify(mapper, never()).deleteById((java.io.Serializable) any());
    }

    @Test
    void update_appliesFields_andNormalizesEnabled() {
        AiTransferRule existing = rule(1L, "old", "any", "kw", 0);
        when(mapper.selectById(1L)).thenReturn(existing);

        service.update(7L, 1L, new AiTransferRuleDTO("new", "all", "a,b", "reason", 1, 9));

        ArgumentCaptor<AiTransferRule> cap = ArgumentCaptor.forClass(AiTransferRule.class);
        verify(mapper).updateById(cap.capture());
        AiTransferRule saved = cap.getValue();
        assertEquals("new", saved.getRuleName());
        assertEquals("all", saved.getMatchMode());
        assertEquals("a,b", saved.getKeywords());
        assertEquals("reason", saved.getTransferReason());
        assertEquals(1, saved.getEnabled());
        assertEquals(9, saved.getPriority());
    }

    // ============ helpers ============

    private static AiTransferRule rule(Long id, String name, String mode, String keywords, int priority) {
        AiTransferRule r = new AiTransferRule();
        r.setId(id);
        r.setTenantId(7L);
        r.setRuleName(name);
        r.setMatchMode(mode);
        r.setKeywords(keywords);
        r.setEnabled(1);
        r.setPriority(priority);
        return r;
    }
}
