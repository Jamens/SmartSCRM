package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.entity.AiTransferRule;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageItemDTO;
import com.smartscrm.server.web.vo.ConversationVO;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * B28 P2 — verifies the rule-engine hook inside {@link MessageService#accept}: an inbound
 * message that matches a rule pushes the owning conversation into the takeover queue via
 * {@link TakeoverService#transferIfAi}, while outbound messages and unmatched inbound
 * messages do not.
 */
class MessageServiceAcceptRuleTest {

    private ChatMessageMapper messageMapper;
    private ChatConversationMapper conversationMapper;
    private CustomerMapper customerMapper;
    private PlatformAccountMapper accountMapper;
    private TakeoverService takeover;
    private AiTransferRuleService aiRuleService;

    private MessageService service;

    @BeforeEach
    void setUp() {
        // accept builds LambdaQueryWrappers on Customer (matchCustomer) and ChatConversation (hook
        // lookup); register both TableInfos so column resolution works without a Spring context.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), Customer.class);
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), ChatConversation.class);

        messageMapper = mock(ChatMessageMapper.class);
        conversationMapper = mock(ChatConversationMapper.class);
        customerMapper = mock(CustomerMapper.class);
        accountMapper = mock(PlatformAccountMapper.class);
        takeover = mock(TakeoverService.class);
        aiRuleService = mock(AiTransferRuleService.class);

        service = new MessageService(messageMapper, conversationMapper, customerMapper, accountMapper,
            takeover, aiRuleService);

        PlatformAccount account = new PlatformAccount();
        account.setId(5L);
        account.setTenantId(7L);
        account.setPlatformType(1); // -> "whatsapp"
        when(accountMapper.selectById(5L)).thenReturn(account);

        // No customer match: open_id lookup returns null, phone fallback returns an empty list.
        when(customerMapper.selectOne(any())).thenReturn(null);
        when(customerMapper.selectList(any())).thenReturn(List.of());

        // Every message in the fixture is "new" (inserted, not a duplicate).
        when(messageMapper.insertIgnoreBatch(any())).thenReturn(1);
        when(conversationMapper.upsertHead(any())).thenReturn(1);
    }

    private MessageItemDTO inbound(String body) {
        return new MessageItemDTO("8613800001001@c.us", "k1", "m1", "in", "8613800001001@c.us",
            "Customer", body, "text", null, 1_000L, "received", "live", "sl1", "Customer");
    }

    private MessageItemDTO outbound(String body) {
        return new MessageItemDTO("8613800001001@c.us", "k2", "m2", "out", "8613800001001@c.us",
            "Seat", body, "text", null, 1_000L, "sent", "live", "sl2", "Seat");
    }

    private ChatConversation aiConversation() {
        ChatConversation conv = new ChatConversation();
        conv.setId(99L);
        conv.setTenantId(7L);
        conv.setAccountId(5L);
        conv.setPlatform("whatsapp");
        conv.setChatKey("8613800001001@c.us");
        conv.setHandlingStatus("AI");
        return conv;
    }

    @Test
    void accept_inboundMatch_triggersTransferToHuman() {
        AiTransferRule rule = new AiTransferRule();
        rule.setId(3L);
        rule.setRuleName("refund");
        rule.setTransferReason("命中退款规则");
        when(aiRuleService.firstMatch(7L, "我要退款")).thenReturn(rule);
        when(conversationMapper.selectOne(any())).thenReturn(aiConversation());
        ConversationVO vo = ConversationVO.of(aiConversation());
        when(takeover.transferIfAi(eq(7L), eq(99L), any())).thenReturn(vo);

        service.accept(7L, new MessageBatchDTO(5L, null, List.of(inbound("我要退款"))));

        verify(takeover).transferIfAi(7L, 99L, "命中退款规则");
    }

    @Test
    void accept_inboundNoMatch_doesNotTransfer() {
        when(aiRuleService.firstMatch(7L, "hello there")).thenReturn(null);

        service.accept(7L, new MessageBatchDTO(5L, null, List.of(inbound("hello there"))));

        verify(takeover, never()).transferIfAi(any(), any(), any());
    }

    @Test
    void accept_outbound_doesNotEvaluateRules() {
        service.accept(7L, new MessageBatchDTO(5L, null, List.of(outbound("我要退款"))));

        verify(aiRuleService, never()).firstMatch(any(), any());
        verify(takeover, never()).transferIfAi(any(), any(), any());
    }

    @Test
    void accept_usesRuleNameAsReasonWhenTransferReasonIsNull() {
        AiTransferRule rule = new AiTransferRule();
        rule.setId(3L);
        rule.setRuleName("refund");
        rule.setTransferReason(null);
        when(aiRuleService.firstMatch(7L, "我要退款")).thenReturn(rule);
        when(conversationMapper.selectOne(any())).thenReturn(aiConversation());
        when(takeover.transferIfAi(eq(7L), eq(99L), any())).thenReturn(ConversationVO.of(aiConversation()));

        service.accept(7L, new MessageBatchDTO(5L, null, List.of(inbound("我要退款"))));

        verify(takeover).transferIfAi(7L, 99L, "rule:refund");
    }
}
