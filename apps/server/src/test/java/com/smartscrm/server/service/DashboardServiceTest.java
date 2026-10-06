package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.smartscrm.server.mapper.BatchSendTaskMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DashboardServiceTest {

    private static final Long TENANT = 1L;

    private ChatMessageMapper messageMapper;
    private CustomerMapper customerMapper;
    private ChatConversationMapper conversationMapper;
    private PlatformAccountMapper accountMapper;
    private BatchSendTaskMapper taskMapper;
    private DashboardService service;

    @BeforeEach
    void setUp() {
        messageMapper = mock(ChatMessageMapper.class);
        customerMapper = mock(CustomerMapper.class);
        conversationMapper = mock(ChatConversationMapper.class);
        accountMapper = mock(PlatformAccountMapper.class);
        taskMapper = mock(BatchSendTaskMapper.class);
        service = new DashboardService(messageMapper, customerMapper, conversationMapper, accountMapper, taskMapper);
    }

    @Test
    void overview_assemblesCountsAndTrend() {
        when(messageMapper.statsTotalsAll(eq(TENANT), any()))
            .thenReturn(Map.of("total", 100L, "inCount", 60L, "outCount", 40L, "activeConversations", 12L));
        when(messageMapper.statsPerDayAll(eq(TENANT), any())).thenReturn(List.of());
        when(accountMapper.selectCount(any())).thenReturn(5L, 3L); // 总数、在线
        when(customerMapper.selectCount(any())).thenReturn(7L);
        when(conversationMapper.selectCount(any())).thenReturn(4L);
        when(taskMapper.selectCount(any())).thenReturn(10L, 2L); // 总数、运行中

        var vo = service.overview(TENANT, 7);

        assertEquals(5L, vo.accountsTotal());
        assertEquals(3L, vo.accountsOnline());
        assertEquals(7L, vo.customersTotal());
        assertEquals(4L, vo.conversationsTotal());
        assertEquals(10L, vo.tasksTotal());
        assertEquals(2L, vo.tasksRunning());
        assertEquals(100L, vo.messageTotal());
        assertEquals(60L, vo.messageIn());
        assertEquals(40L, vo.messageOut());
        assertEquals(12L, vo.activeConversations());
    }

    @Test
    void overview_perDayLengthEqualsDays_evenWhenNoMessages() {
        when(messageMapper.statsTotalsAll(eq(TENANT), any())).thenReturn(Map.of());
        when(messageMapper.statsPerDayAll(eq(TENANT), any())).thenReturn(List.of());
        when(accountMapper.selectCount(any())).thenReturn(0L);
        when(customerMapper.selectCount(any())).thenReturn(0L);
        when(conversationMapper.selectCount(any())).thenReturn(0L);
        when(taskMapper.selectCount(any())).thenReturn(0L);

        var vo = service.overview(TENANT, 7);

        assertEquals(7, vo.perDay().size(), "无消息的日子也要补零，柱条数必须等于 days");
        vo.perDay().forEach(d -> {
            assertEquals(0L, d.inCount());
            assertEquals(0L, d.outCount());
        });
    }

    @Test
    void overview_fillsExistingDayAndZeroFillsMissing() {
        String today = LocalDate.now(com.smartscrm.server.service.msg.MsgTimes.CHAT_ZONE).toString();
        when(messageMapper.statsTotalsAll(eq(TENANT), any())).thenReturn(Map.of());
        when(messageMapper.statsPerDayAll(eq(TENANT), any()))
            .thenReturn(List.of(Map.of("day", today, "inCount", 3L, "outCount", 2L)));
        when(accountMapper.selectCount(any())).thenReturn(0L);
        when(customerMapper.selectCount(any())).thenReturn(0L);
        when(conversationMapper.selectCount(any())).thenReturn(0L);
        when(taskMapper.selectCount(any())).thenReturn(0L);

        var vo = service.overview(TENANT, 7);

        var last = vo.perDay().get(vo.perDay().size() - 1);
        assertEquals(today, last.day());
        assertEquals(3L, last.inCount());
        assertEquals(2L, last.outCount());
    }
}
