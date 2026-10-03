package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/**
 * 群列表行（spec §7 `GET /groups`）。
 *
 * {@code inGroupCount} 与 {@code participantCount} 是两回事，别在界面上混着用：
 * 前者是当前 `is_in_group=1` 的人数（实时），后者是**上一次成功快照**的人数（覆盖率闸的分母）。
 * 快照失败时前者照旧、后者不动，两个数不一致恰恰是"这次快照没记账"的信号。
 */
public record GroupVO(
    String chatKey,
    String title,
    String platform,
    Integer participantCount,
    Integer snapshotCount,
    Integer inGroupCount,
    LocalDateTime lastSnapshotAt,
    LocalDateTime lastEventAt,
    boolean isFinal,
    /** ③：闸落在群行上的两个读数（V13）；界面据此显示"覆盖率 / 为什么没判定"，不在翻页时现算。 */
    Double lastCoverage,
    String lastReconcileReason
) {
}
