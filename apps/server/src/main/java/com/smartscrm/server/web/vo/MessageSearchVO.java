package com.smartscrm.server.web.vo;

import java.util.List;

public record MessageSearchVO(List<SearchHitVO> records, String nextCursor, boolean hasMore) {}
