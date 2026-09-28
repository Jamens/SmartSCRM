package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 任务视图：`account_ids` / `contents` 两个 JSON 列在服务层拆成结构再出参。
 * 时间字段一律 `LocalDateTime` 原样透传（Task 4 Step 2 口径），不换算 epoch 秒。
 */
public record BatchTaskVO(
    Long id, String name, String platform, boolean dryRun, String status,
    List<Long> accountIds, List<String> contents,
    Integer msgIntervalMin, Integer msgIntervalMax, Integer chatIntervalMin, Integer chatIntervalMax,
    Integer totalCount, Integer sentCount, Integer failCount,
    LocalDateTime heartbeatAt, LocalDateTime createdAt
) {
}
