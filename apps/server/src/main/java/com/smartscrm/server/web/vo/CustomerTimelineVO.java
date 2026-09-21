package com.smartscrm.server.web.vo;

import java.util.List;

/**
 * 客户抽屉里"最近消息"一段的数据源：消息 + 该客户名下的会话头。
 * <p>
 * 一次给全、不分页：`messages` 是按 {@link MessageVO#CHRONOLOGICAL} 正序的最近 `size` 条
 * （size 默认 30、上限 200，与查询面同一口径），`conversations` 按 lastMsgTime 倒序。
 * 响应里没有游标——抽屉要的是"一眼看到最近说过什么"，往上翻的入口在记录页，不在这里。
 */
public record CustomerTimelineVO(List<MessageVO> messages, List<ConversationVO> conversations,
                                 long messageCount, long conversationCount) {}
