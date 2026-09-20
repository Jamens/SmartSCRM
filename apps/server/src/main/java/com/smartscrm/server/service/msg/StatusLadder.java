package com.smartscrm.server.service.msg;

import java.util.Set;

/**
 * 发出消息的状态词表。顺序比较不在这里做——写库的单调性由
 * ChatMessageMapper.advanceStatus 的 FIELD() 守卫负责，页内 ack 的翻译由
 * desktop 的 src/shared/chatStatus.ts 负责，这里只回答"这个词是不是发出状态"。
 */
public final class StatusLadder {

    private static final Set<String> LADDER = Set.of("pending", "sent", "delivered", "read");

    private StatusLadder() {
    }

    public static boolean isLadder(String status) {
        return status != null && LADDER.contains(status);
    }

    /** 允许被写入的状态：阶梯上的四个 + 终态 failed。 */
    public static boolean isAllowedTarget(String status) {
        return isLadder(status) || "failed".equals(status);
    }
}
