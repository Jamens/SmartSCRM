package com.smartscrm.server.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.entity.AiRole;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.AiRoleMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.service.AiPersonaService;
import com.smartscrm.server.service.MessageQueryService;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * PersonaEngine 单测（Mockito，不起 Spring）。覆盖 spec T1–T10 与计划补的 T11/T12/T13，
 * 外加「停用人设/停用角色」「system 三段拼接/空段跳过」几条边界。
 */
class PersonaEngineTest {

    private static final Long TENANT = 1L;
    private static final Long CONV = 100L;
    private static final Long PERSONA = 55L;

    private MessageQueryService query;
    private AiPersonaService personaService;
    private AiRoleMapper roleMapper;
    private KnowledgeSearchService searchService;
    private ChatClient chatClient;
    private ChatConversationMapper conversationMapper;
    private ChatMessageMapper messageMapper;
    private PersonaEngine engine;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { ChatConversation.class, ChatMessage.class, AiPersona.class,
            AiRole.class, KnowledgeQa.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        query = mock(MessageQueryService.class);
        personaService = mock(AiPersonaService.class);
        roleMapper = mock(AiRoleMapper.class);
        searchService = mock(KnowledgeSearchService.class);
        chatClient = mock(ChatClient.class);
        conversationMapper = mock(ChatConversationMapper.class);
        messageMapper = mock(ChatMessageMapper.class);
        engine = new PersonaEngine(query, personaService, roleMapper, searchService, chatClient,
            conversationMapper, messageMapper, 10);
    }

    // ===== fixtures =====

    private ChatConversation head(Long personaId) {
        ChatConversation c = new ChatConversation();
        c.setId(CONV);
        c.setTenantId(TENANT);
        c.setAccountId(7L);
        c.setPlatform("whatsapp");
        c.setChatKey("chat-1");
        c.setAiPersonaId(personaId);
        return c;
    }

    private void owned(Long personaId) {
        when(query.requireOwned(TENANT, CONV)).thenReturn(head(personaId));
    }

    private static AiPersona persona(int enabled, Long roleId, String prompt) {
        AiPersona p = new AiPersona();
        p.setId(PERSONA);
        p.setTenantId(TENANT);
        p.setRoleId(roleId);
        p.setPrompt(prompt);
        p.setEnabled(enabled);
        return p;
    }

    private void stubPersona(AiPersona p) {
        when(personaService.get(TENANT, PERSONA)).thenReturn(p);
    }

    private static ChatMessage msg(long id, String direction, String body) {
        ChatMessage m = new ChatMessage();
        m.setId(id);
        m.setDirection(direction);
        m.setBody(body);
        return m;
    }

    /** DB 按 id DESC 返回的顺序（engine 会反转为时间正序）。 */
    private void stubHistory(ChatMessage... descById) {
        when(messageMapper.selectList(any())).thenReturn(Arrays.asList(descById));
    }

    /** 4 条：1 in / 2 out 空正文 / 3 in / 4 out；最近入站 = 3。 */
    private void standardHistory() {
        stubHistory(
            msg(4L, "out", "已为您办理"),
            msg(3L, "in", "怎么退货？"),
            msg(2L, "out", ""),
            msg(1L, "in", "你好"));
    }

    private void standardPreconditions() {
        owned(PERSONA);
        stubPersona(persona(1, null, "亲切语气"));
        standardHistory();
    }

    private static KnowledgeQa qa(Long id, String answer) {
        KnowledgeQa q = new KnowledgeQa();
        q.setId(id);
        q.setAnswer(answer);
        return q;
    }

    @SuppressWarnings("unchecked")
    private List<ChatClient.Msg> capturedMessages() {
        ArgumentCaptor<List<ChatClient.Msg>> cap = ArgumentCaptor.forClass(List.class);
        verify(chatClient).complete(cap.capture());
        return cap.getValue();
    }

    private void modelAvailable(String reply) {
        when(chatClient.available()).thenReturn(true);
        when(chatClient.complete(any())).thenReturn(reply);
    }

    private void searchDisabled() {
        when(searchService.available()).thenReturn(false);
    }

    private void searchNoHit() {
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), any(), any(), any(), any()))
            .thenReturn(List.of());
    }

    private void assertModelFailureDoesNotWrite(String failure) {
        standardPreconditions();
        searchDisabled();
        when(chatClient.available()).thenReturn(true);
        when(chatClient.complete(any())).thenThrow(new BizException(40906, failure));

        assertThrows(BizException.class, () -> engine.suggest(TENANT, CONV),
            "模型失败必须抛明确业务异常（R5）");
        verify(conversationMapper, never()).update(any(), any());
    }

    // ===== T1：未配 chat 端点 =====

    @Test
    void T1_chatNotConfigured_throws40906AndNoWrite() {
        standardPreconditions();
        searchDisabled();
        when(chatClient.available()).thenReturn(false);

        BizException ex = assertThrows(BizException.class, () -> engine.suggest(TENANT, CONV));
        assertEquals(40906, ex.getCode());
        verify(conversationMapper, never()).update(any(), any());
    }

    // ===== T2：检索命中 =====

    @Test
    void T2_retrievalHit_sourceRetrievalAndNoModelCall() {
        standardPreconditions();
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), any(), any(), any(), any()))
            .thenReturn(List.of(new KnowledgeSearchService.Hit(qa(9L, "标准答案"), 0.82f)));

        PersonaEngine.Suggestion s = engine.generate(TENANT, CONV);

        assertEquals("retrieval", s.source());
        assertEquals("标准答案", s.text());
        assertEquals(9L, s.qaId());
        assertEquals(0.82f, s.score(), 1e-6);
        verify(chatClient, never()).complete(any());
    }

    // ===== T3：检索未命中 + 模型可用 =====

    @Test
    void T3_noHitModelAvailable_sourceModelWithNullScoreAndQaId() {
        standardPreconditions();
        searchNoHit();
        modelAvailable("模型生成回复");

        PersonaEngine.Suggestion s = engine.generate(TENANT, CONV);

        assertEquals("model", s.source());
        assertEquals("模型生成回复", s.text());
        assertNull(s.qaId(), "模型建议没有 qaId");
        assertNull(s.score(), "模型建议没有相似度分数");
    }

    // ===== T4/T5/T6：模型失败一律不写库（R5） =====

    @Test
    void T4_modelNon2xx_doesNotWrite() {
        assertModelFailureDoesNotWrite("chat 端点返回异常状态 500");
    }

    @Test
    void T5_modelTimeout_doesNotWrite() {
        assertModelFailureDoesNotWrite("chat 端点不可达或超时");
    }

    @Test
    void T6_modelMalformedResponse_doesNotWrite() {
        assertModelFailureDoesNotWrite("chat 响应解析失败");
    }

    // ===== T7：未绑人设 =====

    @Test
    void T7_noPersona_rejectsAndZeroCalls() {
        owned(null);

        assertThrows(BizException.class, () -> engine.generate(TENANT, CONV));
        verify(chatClient, never()).complete(any());
        verify(searchService, never()).search(any(), any(), any(), any(), any(), any());
        verify(conversationMapper, never()).update(any(), any());
    }

    // ===== T8：跨租户人设 =====

    @Test
    void T8_crossTenantPersona_rejects() {
        owned(PERSONA);
        when(personaService.get(TENANT, PERSONA))
            .thenThrow(new BizException(40404, "人设不存在: " + PERSONA));

        assertThrows(BizException.class, () -> engine.generate(TENANT, CONV));
        verify(chatClient, never()).complete(any());
        verify(conversationMapper, never()).update(any(), any());
    }

    // ===== T9：停用人设 / 停用角色 =====

    @Test
    void T9a_disabledPersona_rejects() {
        owned(PERSONA);
        stubPersona(persona(0, null, "亲切语气"));
        standardHistory();

        assertThrows(BizException.class, () -> engine.generate(TENANT, CONV));
        verify(chatClient, never()).complete(any());
    }

    @Test
    void T9b_disabledRole_rejects() {
        owned(PERSONA);
        stubPersona(persona(1, 7L, "亲切语气"));
        standardHistory();
        AiRole role = new AiRole();
        role.setId(7L);
        role.setTenantId(TENANT);
        role.setEnabled(0);
        when(roleMapper.selectById(7L)).thenReturn(role);

        assertThrows(BizException.class, () -> engine.generate(TENANT, CONV));
        verify(chatClient, never()).complete(any());
    }

    // ===== T10：历史方向映射 / 空正文跳过 / system 不含客户正文 =====

    @Test
    void T10_historyDirectionMappingAndBlankSkipped() {
        standardPreconditions();
        searchDisabled();
        modelAvailable("回复");

        engine.generate(TENANT, CONV);
        List<ChatClient.Msg> msgs = capturedMessages();

        assertEquals("system", msgs.get(0).role());
        String system = msgs.get(0).content();
        assertTrue(system.contains("你是客服助手"), "固定护栏段");
        assertFalse(system.contains("你好"), "system 段绝不含客户正文");
        assertFalse(system.contains("怎么退货"));
        assertFalse(system.contains("已为您办理"));

        // 反转为时间正序：1(in) / 3(in) / 4(out)，2 的空正文被跳过
        assertEquals(4, msgs.size(), "system + 3 条有效历史");
        assertEquals("user", msgs.get(1).role());
        assertEquals("你好", msgs.get(1).content());
        assertEquals("user", msgs.get(2).role());
        assertEquals("怎么退货？", msgs.get(2).content());
        assertEquals("assistant", msgs.get(3).role());
        assertEquals("已为您办理", msgs.get(3).content());
    }

    @Test
    void T10b_systemAssemblesGuardrailRoleAndPersona() {
        owned(PERSONA);
        stubPersona(persona(1, 7L, "亲切语气"));
        standardHistory();
        AiRole role = new AiRole();
        role.setId(7L);
        role.setTenantId(TENANT);
        role.setEnabled(1);
        role.setPrompt("你是售后专员");
        when(roleMapper.selectById(7L)).thenReturn(role);
        searchDisabled();
        modelAvailable("回复");

        engine.generate(TENANT, CONV);
        String system = capturedMessages().get(0).content();

        assertTrue(system.contains("你是客服助手"), "固定护栏");
        assertTrue(system.contains("你是售后专员"), "ai_role.prompt");
        assertTrue(system.contains("亲切语气"), "ai_persona.prompt");
        assertFalse(system.contains("怎么退货"), "system 段绝不含客户正文");
    }

    @Test
    void T10c_systemSkipsBlankSegments() {
        owned(PERSONA);
        stubPersona(persona(1, null, "   ")); // 人设 prompt 空白
        standardHistory();
        searchDisabled();
        modelAvailable("回复");

        engine.generate(TENANT, CONV);
        String system = capturedMessages().get(0).content();

        assertTrue(system.contains("你是客服助手"), "缺项跳过，但固定护栏仍在");
        assertFalse(system.contains("亲切"), "空白人设段不拼接");
        assertFalse(system.contains("你好"), "system 段绝不含客户正文");
    }

    // ===== T11：D1 检索未启用 → 跳过检索直接走模型 =====

    @Test
    void T11_searchDisabled_skipsToModel() {
        standardPreconditions();
        searchDisabled();
        modelAvailable("模型回复");

        PersonaEngine.Suggestion s = engine.generate(TENANT, CONV);

        assertEquals("model", s.source());
        verify(searchService, never()).search(any(), any(), any(), any(), any(), any());
        verify(chatClient).complete(any());
    }

    // ===== T12：D1 检索抛 40905 → 记 warn 后仍走模型 =====

    @Test
    void T12_searchThrows40905_fallsBackToModel() {
        standardPreconditions();
        when(searchService.available()).thenReturn(true);
        when(searchService.search(eq(TENANT), anyString(), any(), any(), any(), any()))
            .thenThrow(new BizException(40905, "知识库检索未启用"));
        modelAvailable("模型回复");

        PersonaEngine.Suggestion s = engine.generate(TENANT, CONV);

        assertEquals("model", s.source(), "检索失败不阻断模型兜底");
        verify(chatClient).complete(any());
    }

    // ===== T13：D2 模型建议写库显式把 score/qaId 置 null =====

    @Test
    @SuppressWarnings("unchecked")
    void T13_modelSuggestionWritesExplicitNulls() {
        standardPreconditions();
        searchDisabled();
        modelAvailable("模型回复");

        engine.suggest(TENANT, CONV);

        ArgumentCaptor<LambdaUpdateWrapper<ChatConversation>> cap =
            ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(conversationMapper).update(any(), cap.capture());
        LambdaUpdateWrapper<ChatConversation> w = cap.getValue();
        // 纯单测环境没有 MyBatis 的全局 columnUnderline 配置，getSqlSet() 暴露实体属性名（驼峰）；
        // 生产运行时由 MyBatis 映射成下划线列名。这里断言的是「wrapper 里确实有这四个 set」。
        String set = w.getSqlSet();
        assertTrue(set.contains("aiSuggestion"), "建议正文");
        assertTrue(set.contains("aiSuggestionSource"), "来源列");
        assertTrue(set.contains("aiSuggestionScore"), "D2：score 必须显式 set");
        assertTrue(set.contains("aiSuggestionQaId"), "D2：qaId 必须显式 set");
        long nulls = w.getParamNameValuePairs().values().stream().filter(Objects::isNull).count();
        assertEquals(2L, nulls, "score 与 qaId 显式置 null，避免残留上一次检索建议的旧值");
    }
}
