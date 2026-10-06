package com.smartscrm.server.web.vo;

import java.util.List;

/** B11 仪表盘总览。计数均按租户收窄；perDay 长度恒等于请求的 days（无消息的日子补零）。 */
public record DashboardVO(
    long accountsTotal, long accountsOnline,
    long customersTotal, long conversationsTotal,
    long tasksTotal, long tasksRunning,
    long messageTotal, long messageIn, long messageOut, long activeConversations,
    List<DayCountVO> perDay) {
}
