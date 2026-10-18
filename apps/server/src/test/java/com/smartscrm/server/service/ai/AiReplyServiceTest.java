package com.smartscrm.server.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.AiPersonaMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * B28 第四段 AI 自动应答单测。
 *
 * <p>要守的三条口径都在这里：只在 AI 态应答（不抢坐席）、检索未启用/无命中静默跳过、
 * 异常不外溢到消息入库这条正事。检索本身的召回口径由 {@code KnowledgeSearchServiceTest} 负责，
 * 这里把 KnowledgeSearchService mock 掉，只测接线对不对。
 */
class AiReplyServiceTest {

    private static final Long TENANT = 1L;
    private static final Long CONV = 100L;

    private ChatConversationMapper conversationMapper;
    private AiPersonaMapper personaMapper;
    private KnowledgeSearchService searchService;
    private AiReplyService service;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, ChatConversation.class);
        TableInfoHelper.initTableInfo(asst, AiPersona.class);
        conversationMapper = mock(ChatConversationMapper.class);
        personaMapper = mock(AiPersonaMapper.class);
        searchService = mock(KnowledgeSearchService.class);
        service = new AiReplyService(conversationMapper, personaMapper, searchService);
    }

    private void stubConversation(String handlingStatus, Long personaId) {
        ChatConversation c = new ChatConversation();
        c.setId(CONV);
        c.setTenantId(TENANT);
        c.setHandlingStatus(handlingStatus);
        c.setAiPersonaId(personaId);
        when(conversationMapper.selectOne(any())).thenReturn(c);
    }

    private static KnowledgeQa qa(Long id) {
        KnowledgeQa q = new KnowledgeQa();
        q.setId(id);
        q.setAnswer("这是建议答案");
        return q;
    }

    // ===== 只有 AI 态才应答 =====

    @Test
    void suggest_writesSuggestionWhenAiStateAndConfidentHit() {
        stubConversation("AI", null);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), any(), any()))
            .thenReturn(java.util.List.of(new KnowledgeSearchService.Hit(qa(9L), 0.82f)));

        assertTrue(service.suggestIfAi(TENANT, CONV, "怎么退货？"));
        verify(conversationMapper).update(any(), any());
    }

    @Test
    void suggest_skipsWhenHumanActive() {
        // 坐席已接管：一条新入站消息不该覆盖坐席正在服务的会话
        stubConversation("HUMAN_ACTIVE", null);
        when(searchService.available()).thenReturn(true);

        assertFalse(service.suggestIfAi(TENANT, CONV, "在吗"));
        verify(conversationMapper, never()).update(any(), any());
    }

    @Test
    void suggest_skipsWhenWaitingTakeover() {
        stubConversation("WAITING_TAKEOVER", null);
        when(searchService.available()).thenReturn(true);

        assertFalse(service.suggestIfAi(TENANT, CONV, "在吗"));
        verify(conversationMapper, never()).update(any(), any());
    }

    // ===== 降级路径：静默跳过，不打扰主流程 =====

    @Test
    void suggest_skipsWhenSearchNotEnabled() {
        // 端点未配置是配置问题，不该因一条消息就报错
        stubConversation("AI", null);
        when(searchService.available()).thenReturn(false);

        assertFalse(service.suggestIfAi(TENANT, CONV, "怎么退货"));
        verify(conversationMapper, never()).update(any(), any());
    }

    @Test
    void suggest_skipsWhenNoHitAboveThreshold() {
        stubConversation("AI", null);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), any(), any()))
            .thenReturn(java.util.List.of());

        assertFalse(service.suggestIfAi(TENANT, CONV, "无关的问题"));
        verify(conversationMapper, never()).update(any(), any());
    }

    @Test
    void suggest_skipsBlankBody() {
        assertFalse(service.suggestIfAi(TENANT, CONV, "   "));
        verify(searchService, never()).search(anyLong(), anyString(), anyInt(), any(), any(), any());
    }

    @Test
    void suggest_swallowsSearchFailure() {
        // 检索端点挂了也不能把「消息入库」这个正事带崩
        stubConversation("AI", null);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), any(), any()))
            .thenThrow(new RuntimeException("embedding 端点不可达"));

        assertFalse(service.suggestIfAi(TENANT, CONV, "怎么退货"));
    }

    @Test
    void suggest_skipsWhenConversationMissing() {
        when(searchService.available()).thenReturn(true);
        when(conversationMapper.selectOne(any())).thenReturn(null);

        assertFalse(service.suggestIfAi(TENANT, CONV, "怎么退货"));
        verify(searchService, never()).search(anyLong(), anyString(), anyInt(), any(), any(), any());
    }

    // ===== 人设 → 角色收窄 =====

    @Test
    void suggest_narrowsSearchToPersonaRole() {
        stubConversation("AI", 55L);
        AiPersona persona = new AiPersona();
        persona.setId(55L);
        persona.setTenantId(TENANT);
        persona.setRoleId(7L);
        when(personaMapper.selectById(55L)).thenReturn(persona);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), eq(7L), any()))
            .thenReturn(java.util.List.of(new KnowledgeSearchService.Hit(qa(9L), 0.9f)));

        assertTrue(service.suggestIfAi(TENANT, CONV, "怎么退货"));
    }

    @Test
    void suggest_fallsBackToAllKnowledgeWhenPersonaMissing() {
        // 人设查不到不该阻断应答，退回全租户通用知识（roleId=null）
        stubConversation("AI", 55L);
        when(personaMapper.selectById(55L)).thenReturn(null);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), eq(null), any()))
            .thenReturn(java.util.List.of(new KnowledgeSearchService.Hit(qa(9L), 0.9f)));

        assertTrue(service.suggestIfAi(TENANT, CONV, "怎么退货"));
    }

    @Test
    void suggest_ignoresPersonaOfOtherTenant() {
        stubConversation("AI", 55L);
        AiPersona persona = new AiPersona();
        persona.setId(55L);
        persona.setTenantId(999L); // 别人的
        persona.setRoleId(7L);
        when(personaMapper.selectById(55L)).thenReturn(persona);
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), anyInt(), any(), eq(null), any()))
            .thenReturn(java.util.List.of(new KnowledgeSearchService.Hit(qa(9L), 0.9f)));

        assertTrue(service.suggestIfAi(TENANT, CONV, "怎么退货"));
    }

    // ===== 清理 =====

    @Test
    void clearSuggestion_clearsAllThreeFields() {
        service.clearSuggestion(TENANT, CONV);
        verify(conversationMapper).update(any(), any());
    }
}
