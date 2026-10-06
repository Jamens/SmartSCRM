package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.entity.BatchSendTask;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.BatchSendTaskMapper;import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.web.vo.DayCountVO;
import com.smartscrm.server.web.vo.DashboardVO;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * B11 报表仪表盘——租户级总览（一次调用拿齐首页所有指标）。
 *
 * <p>所有计数都按 {@code tenantId} 收窄（租户隔离）。消息趋势走 {@link ChatMessageMapper}
 * 的**租户级** stats（{@code statsTotalsAll}/{@code statsPerDayAll}，跨该租户所有账号），
 * 不是按账号那版——仪表盘看的是全租户。没消息的日子由本层补零，柱条数恒等于 days。
 */
@Service
public class DashboardService {

    private final ChatMessageMapper messageMapper;
    private final CustomerMapper customerMapper;
    private final ChatConversationMapper conversationMapper;
    private final PlatformAccountMapper accountMapper;
    private final BatchSendTaskMapper taskMapper;

    public DashboardService(ChatMessageMapper messageMapper, CustomerMapper customerMapper,
                            ChatConversationMapper conversationMapper, PlatformAccountMapper accountMapper,
                            BatchSendTaskMapper taskMapper) {
        this.messageMapper = messageMapper;
        this.customerMapper = customerMapper;
        this.conversationMapper = conversationMapper;
        this.accountMapper = accountMapper;
        this.taskMapper = taskMapper;
    }

    public DashboardVO overview(Long tenantId, Integer days) {
        int window = days == null || days <= 0 ? 7 : Math.min(days, 90);
        // 时钟只读一次（同 MessageQueryService 的理由）：窗口起点与序列末日必须是同一个"今天"。
        LocalDate today = LocalDate.now(MsgTimes.CHAT_ZONE);
        LocalDateTime from = today.minusDays(window - 1L).atStartOfDay();

        Map<String, Object> totals = messageMapper.statsTotalsAll(tenantId, from);
        Map<String, Map<String, Object>> perDay = new HashMap<>();
        for (Map<String, Object> row : messageMapper.statsPerDayAll(tenantId, from)) {
            perDay.put(String.valueOf(row.get("day")), row);
        }
        List<DayCountVO> series = new ArrayList<>(window);
        for (int i = window - 1; i >= 0; i--) {
            String day = today.minusDays(i).toString();
            Map<String, Object> row = perDay.get(day);
            series.add(row == null
                ? new DayCountVO(day, 0, 0)
                : new DayCountVO(day, num(row, "inCount"), num(row, "outCount")));
        }

        long accountsTotal = accountMapper.selectCount(
            new LambdaQueryWrapper<PlatformAccount>().eq(PlatformAccount::getTenantId, tenantId));
        long accountsOnline = accountMapper.selectCount(
            new LambdaQueryWrapper<PlatformAccount>().eq(PlatformAccount::getTenantId, tenantId)
                .eq(PlatformAccount::getStatus, 1));
        long customersTotal = customerMapper.selectCount(
            new LambdaQueryWrapper<Customer>().eq(Customer::getTenantId, tenantId));
        long conversationsTotal = conversationMapper.selectCount(
            new LambdaQueryWrapper<ChatConversation>().eq(ChatConversation::getTenantId, tenantId));
        long tasksTotal = taskMapper.selectCount(
            new LambdaQueryWrapper<BatchSendTask>().eq(BatchSendTask::getTenantId, tenantId));
        long tasksRunning = taskMapper.selectCount(
            new LambdaQueryWrapper<BatchSendTask>().eq(BatchSendTask::getTenantId, tenantId)
                .eq(BatchSendTask::getStatus, "running"));

        return new DashboardVO(accountsTotal, accountsOnline, customersTotal, conversationsTotal,
            tasksTotal, tasksRunning,
            num(totals, "total"), num(totals, "inCount"), num(totals, "outCount"),
            num(totals, "activeConversations"), series);
    }

    private static long num(Map<String, Object> row, String key) {
        if (row == null) return 0L;
        Object v = row.get(key);
        return v == null ? 0L : ((Number) v).longValue();
    }
}
