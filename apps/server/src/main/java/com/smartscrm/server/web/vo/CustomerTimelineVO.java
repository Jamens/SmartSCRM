package com.smartscrm.server.web.vo;

import java.util.List;

/**
 * 客户抽屉里"最近消息"一段的数据源：消息 + 该客户名下的会话头。
 * 分页只在消息上做，会话头一次给全（一个客户名下的会话数是个位数）。
 */
public record CustomerTimelineVO(List<MessageVO> messages, List<ConversationVO> conversations,
                                 long messageCount, long conversationCount) {}
