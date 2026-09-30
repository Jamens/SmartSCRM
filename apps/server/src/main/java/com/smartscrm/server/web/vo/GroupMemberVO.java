package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/**
 * 成员名单行（spec §7 `GET /group/members`）。
 *
 * 两个时间列最容易读错，语义写在这里：
 * <ul>
 *   <li>{@code latestJoinAt} 进群时间，来自事件；为空表示"我们没看见他进来"。</li>
 *   <li>{@code firstSeenAt} 本应用第一次看见他，**不是**进群时间。快照建档的人只有这个值。</li>
 * </ul>
 * {@code exitMethod='snapshot_absent'} 且 {@code latestLeaveAt} 为空 = 推定退群，界面该显示"—"
 * 而不是拿某个时刻冒充退群时间（spec §8）。
 */
public record GroupMemberVO(
    String chatKey,
    String memberKey,
    String phone,
    String displayName,
    String roleType,
    boolean isInGroup,
    Integer joinCount,
    LocalDateTime latestJoinAt,
    LocalDateTime latestLeaveAt,
    String exitMethod,
    LocalDateTime firstSeenAt,
    LocalDateTime lastEventAt,
    Integer snapshotSeenCount,
    Long customerId,
    /** 该成员在这个群里的最后发言时间；从 chat_message 按 (chat_key, sender_key) 聚合。 */
    LocalDateTime lastMsgAt,
    /** 最近发言**所在那一天**的发言条数——锚定该成员的最近发言日，不是导出/查询执行日。 */
    Long dayMsgCount,
    Long msgCount
) {
}
