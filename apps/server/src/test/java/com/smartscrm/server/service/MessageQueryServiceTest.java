package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.web.vo.ConversationPageVO;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MessageQueryServiceTest {

    private ChatMessageMapper messageMapper;
    private ChatConversationMapper conversationMapper;
    private CustomerMapper customerMapper;
    private MessageService messageService;
    private MessageQueryService service;

    @BeforeEach
    void setUp() {
        // Pure unit test has no Spring context, so register the entity's TableInfo manually;
        // otherwise LambdaQueryWrapper can't resolve column names.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), ChatConversation.class);
        messageMapper = mock(ChatMessageMapper.class);
        conversationMapper = mock(ChatConversationMapper.class);
        customerMapper = mock(CustomerMapper.class);
        messageService = mock(MessageService.class);
        service = new MessageQueryService(messageMapper, conversationMapper, customerMapper, messageService);

        ChatConversation head = new ChatConversation();
        head.setId(1L);
        head.setTenantId(7L);
        head.setLastMsgTime(LocalDateTime.now());
        head.setHandlingStatus("WAITING_TAKEOVER");
        when(conversationMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(head));
    }

    private LambdaQueryWrapper<ChatConversation> capturedWrapper() {
        ArgumentCaptor<LambdaQueryWrapper<ChatConversation>> cap = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(conversationMapper).selectList(cap.capture());
        return cap.getValue();
    }

    @Test
    void conversations_filtersByHandlingStatus_whenProvided() {
        ConversationPageVO page = service.conversations(7L, null, null, null, null, null, "WAITING_TAKEOVER");

        assertEquals(1, page.records().size());
        // Without MP's global underline strategy in the test config the column resolves as
        // camelCase; the production DB column is handling_status (migration V16). The contract
        // under test: the list query carries a handlingStatus filter (value binding is MyBatis-Plus's
        // job and is covered by the e2e probe). Query wrappers expose an empty param map, so we
        // assert on the generated SQL instead.
        String where = capturedWrapper().getTargetSql();
        assertTrue(where.contains("handlingStatus") && where.contains("?"),
            "WHERE must filter by handlingStatus with a bound param: " + where);
    }

    @Test
    void conversations_omitsHandlingStatusFilter_whenNull() {
        service.conversations(7L, null, null, null, null, null, null);

        String where = capturedWrapper().getTargetSql();
        assertTrue(!where.contains("handlingStatus"),
            "WHERE must not mention handlingStatus when it is null: " + where);
    }

    @Test
    void conversations_rejectsInvalidHandlingStatus() {
        BizException ex = assertThrows(BizException.class,
            () -> service.conversations(7L, null, null, null, null, null, "NONSENSE"));

        assertEquals(40000, ex.getCode());
    }
}
