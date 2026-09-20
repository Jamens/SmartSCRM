package com.smartscrm.server.service.msg;

import java.util.Set;

/**
 * 发出消息的状态词表。顺序比较不在这里做——写库的单调性由
 * ChatMessageMapper.advanceStatus 的 FIELD() 守卫负责，页内 ack 的翻译由
 * desktop 的 src/shared/chatStatus.ts 负责，这里只回答"这个词是不是发出状态"。
 * <p>
 * 词表归本类，顺序归 SQL：这是既定的划分，本类不引入 rank / 序数 / canAdvance。
 */
public final class StatusLadder {

    /**
     * 与 ChatMessageMapper.advanceStatus 的 IN 清单成对：
     * status IN ('pending', 'sent', 'delivered', 'read')
     * AND FIELD(status, 'pending', 'sent', 'delivered', 'read')
     *     &lt; FIELD(#{toStatus}, 'pending', 'sent', 'delivered', 'read')。
     * 改一边必须看另一边——词表在这里、顺序在那里，两边都写才能对上。
     */
    private static final Set<String> LADDER = Set.of("pending", "sent", "delivered", "read");

    private StatusLadder() {
    }

    /** 是不是发出阶梯上的词。入站行的 'received' 不在这个集合里，它由 direction 决定。 */
    public static boolean isLadder(String status) {
        return status != null && LADDER.contains(status);
    }

    /**
     * 允许被写入的状态：阶梯上的四个 + 终态 failed。
     * <p>
     * 只用于发出行（direction='out'）：入站行的 status 恒为库默认的 'received'，
     * 那个值由 direction 决定、不经本方法判定，所以 isAllowedTarget("received") 是 false 而不是漏项。
     * <p>
     * 'pending' 只在初始插入时合法（消息刚发出、还没有任何 ack）；作为推进目标它不合法——
     * advanceStatus 的目标清单只有 'sent' / 'delivered' / 'read' 与 'failed'，
     * 所以 isAllowedTarget("pending") 比 SQL 的目标集合宽，这一点是刻意的：
     * 本方法回答"能不能被写进这一列"，不回答"能不能从别的状态推进到这里"。
     */
    public static boolean isAllowedTarget(String status) {
        return isLadder(status) || "failed".equals(status);
    }
}
