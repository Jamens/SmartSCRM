package com.smartscrm.server.web.vo;

import java.util.List;

/** records 按 msg_time 正序返回，游标本身是倒序取页（往上翻页），渲染层不再 reverse。 */
public record MessagePageVO(List<MessageVO> records, String nextCursor, boolean hasMore) {}
