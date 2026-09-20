package com.smartscrm.server.web.vo;

import java.util.List;

public record ConversationPageVO(List<ConversationVO> records, String nextCursor, boolean hasMore) {}
