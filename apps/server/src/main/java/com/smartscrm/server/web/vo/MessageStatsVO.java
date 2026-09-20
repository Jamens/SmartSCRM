package com.smartscrm.server.web.vo;

import java.util.List;

/** total 是窗口内的总数，perDay 的长度恒等于 days：没有消息的日子补零，柱条数不能少。 */
public record MessageStatsVO(long total, long inCount, long outCount, long activeConversations,
                             List<DayCountVO> perDay) {}
