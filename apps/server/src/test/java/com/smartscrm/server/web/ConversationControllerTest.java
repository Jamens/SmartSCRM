package com.smartscrm.server.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiPersonaService;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.service.TakeoverService;
import com.smartscrm.server.service.ai.AiReplyService;
import com.smartscrm.server.service.ai.PersonaEngine;
import com.smartscrm.server.web.vo.ConversationVO;
import java.util.Objects;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B28 两个新端点的接线单测：绑定校验（本租户 + enabled）/ 解绑 / 委托引擎，租户一律取 principal。 */
class ConversationControllerTest {

    private static final Long TENANT = 1L;
    private static final Long CONV = 100L;
    private static final Long PERSONA = 55L;

    private MessageQueryService query;
    private AiPersonaService personaService;
    private PersonaEngine personaEngine;
    private ChatConversationMapper conversationMapper;
    private ConversationController controller;
    private AuthPrincipal principal;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), ChatConversation.class);
        query = mock(MessageQueryService.class);
        TakeoverService takeover = mock(TakeoverService.class);
        AiReplyService aiReplyService = mock(AiReplyService.class);
        personaService = mock(AiPersonaService.class);
        personaEngine = mock(PersonaEngine.class);
        conversationMapper = mock(ChatConversationMapper.class);
        controller = new ConversationController(query, takeover, aiReplyService, personaService,
            personaEngine, conversationMapper);
        principal = AuthPrincipal.of(9L, TENANT, "invite", "agent");
    }

    private ChatConversation head() {
        ChatConversation c = new ChatConversation();
        c.setId(CONV);
        c.setTenantId(TENANT);
        return c;
    }

    private void owned() {
        when(query.requireOwned(TENANT, CONV)).thenReturn(head());
    }

    private static AiPersona persona(int enabled) {
        AiPersona p = new AiPersona();
        p.setId(PERSONA);
        p.setTenantId(TENANT);
        p.setEnabled(enabled);
        return p;
    }

    @SuppressWarnings("unchecked")
    private LambdaUpdateWrapper<ChatConversation> capturedUpdate() {
        ArgumentCaptor<LambdaUpdateWrapper<ChatConversation>> cap =
            ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(conversationMapper).update(any(), cap.capture());
        return cap.getValue();
    }

    private static ConversationController.AiPersonaBindRequest bind(Long personaId) {
        return new ConversationController.AiPersonaBindRequest(personaId);
    }

    @Test
    void bindAiPersona_nullUnbinds() {
        owned();

        controller.bindAiPersona(principal, CONV, bind(null));

        LambdaUpdateWrapper<ChatConversation> w = capturedUpdate();
        assertTrue(w.getSqlSet().contains("aiPersonaId"), "解绑也要显式写 null");
        assertTrue(w.getParamNameValuePairs().values().stream().anyMatch(Objects::isNull));
        verify(personaService, never()).get(any(), any());
    }

    @Test
    void bindAiPersona_enabledPersona_writesId() {
        owned();
        when(personaService.get(TENANT, PERSONA)).thenReturn(persona(1));

        controller.bindAiPersona(principal, CONV, bind(PERSONA));

        assertTrue(capturedUpdate().getParamNameValuePairs().containsValue(PERSONA));
    }

    @Test
    void bindAiPersona_crossTenantPersona_rejects() {
        owned();
        when(personaService.get(TENANT, PERSONA)).thenThrow(new BizException(40404, "人设不存在: 55"));

        assertThrows(BizException.class, () -> controller.bindAiPersona(principal, CONV, bind(PERSONA)));
        verify(conversationMapper, never()).update(any(), any());
    }

    @Test
    void bindAiPersona_disabledPersona_rejects() {
        owned();
        when(personaService.get(TENANT, PERSONA)).thenReturn(persona(0));

        assertThrows(BizException.class, () -> controller.bindAiPersona(principal, CONV, bind(PERSONA)));
        verify(conversationMapper, never()).update(any(), any());
    }

    @Test
    void generateAiSuggestion_delegatesWithTenantScope() {
        ConversationVO vo = ConversationVO.of(head());
        when(personaEngine.suggest(TENANT, CONV)).thenReturn(vo);

        assertEquals(vo, controller.generateAiSuggestion(principal, CONV).data());
        verify(personaEngine).suggest(TENANT, CONV);
    }
}
