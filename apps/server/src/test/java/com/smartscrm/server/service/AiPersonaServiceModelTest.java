package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.mapper.AiPersonaMapper;
import com.smartscrm.server.service.ai.ChatClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 任务 9：generateDraft 的模型分支。
 *
 * <p>三条契约：模型可用 → 用模型产出的 prompt 且标 {@code source=model}；
 * 模型抛异常 → 静默回落内置模板且不报错；端点未配（含 chatClient=null 旧构造器）→ 走模板且绝不调模型。
 * generateDraft 只读内置模板 / 调模型，不碰 mapper，故无需 TableInfoHelper 初始化。
 */
class AiPersonaServiceModelTest {

    private AiPersonaMapper mapper;
    private ChatClient chatClient;

    @BeforeEach
    void setUp() {
        mapper = mock(AiPersonaMapper.class);
        chatClient = mock(ChatClient.class);
    }

    @Test
    void generateDraft_modelAvailable_usesModelPromptAndMarksSourceModel() {
        when(chatClient.available()).thenReturn(true);
        when(chatClient.complete(anyList())).thenReturn("你是一名由模型生成的亲切客服，先共情再解决问题。");

        var d = new AiPersonaService(mapper, chatClient).generateDraft("friendly");

        assertEquals("model", d.source(), "模型路径必须标 source=model");
        assertEquals("你是一名由模型生成的亲切客服，先共情再解决问题。", d.prompt(), "prompt 用模型产出");
        // 模板元信息仍保留，前端据此知道草稿基于哪个模板 / 语气
        assertEquals("friendly", d.template());
        assertEquals("亲切客服", d.name());
        assertEquals("friendly", d.tone());
        verify(chatClient).complete(anyList());
    }

    @Test
    void generateDraft_modelThrows_fallsBackToTemplateSilently() {
        when(chatClient.available()).thenReturn(true);
        when(chatClient.complete(anyList())).thenThrow(new BizException(40906, "端点不可达"));

        AiPersonaService svc = new AiPersonaService(mapper, chatClient);
        var d = assertDoesNotThrow(() -> svc.generateDraft("pro"), "模型失败不得向调用方报错");

        assertEquals("template", d.source(), "回落草稿标 source=template");
        assertEquals("pro", d.template());
        assertFalse(d.prompt() == null || d.prompt().isBlank(), "回落时 prompt 用内置模板，非空");
    }

    @Test
    void generateDraft_endpointNotConfigured_usesTemplateAndNeverCallsModel() {
        when(chatClient.available()).thenReturn(false);

        var d = new AiPersonaService(mapper, chatClient).generateDraft("concise");

        assertEquals("template", d.source());
        assertEquals("concise", d.template());
        verify(chatClient, never()).complete(anyList());

        // 旧构造器（chatClient=null，既有 AiPersonaNurtureServiceTest 走这条）同样回落模板，且不报错
        var d2 = assertDoesNotThrow(() -> new AiPersonaService(mapper).generateDraft("friendly"));
        assertEquals("template", d2.source());
    }
}
