package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * 群登记册（V12 / spec §3）。
 *
 * 刻意不复用 {@code chat_conversation WHERE is_group=1}：会话头只被消息驱动，
 * 而页内 {@code getAllGroups} 能列出**从没发过消息的群**。少了这张表，群名单与它下游的
 * 目标池（{@link GroupMemberState}）都会少一批人——那种缺失是静默的，界面上看不出来。
 */
@Data
@TableName("chat_group")
public class ChatGroup {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String title;

    /**
     * 覆盖率闸的**分母**，只被成功快照覆盖。
     * 失败拉取绝不能写这一列：分母被一次坏快照压低后，下一次好快照算出的覆盖率会虚高，
     * 闸就形同虚设（spec §6 陷阱①）。
     */
    private Integer participantCount;
    private LocalDateTime lastSnapshotAt;
    private Integer snapshotCount;
    /** 最近一次快照判定的覆盖率。只有 {@link com.smartscrm.server.mapper.ChatGroupMapper} 的 `markSnapshotSuccess` / `markGate` 写它。 */
    private Double lastCoverage;
    /** 最近一次判定结论：`ok | first_build | coverage_too_low | no_snapshot`。 */
    private String lastReconcileReason;
    /** 1 = 群已解散/账号已退出：建档泵跳过它，但流水仍要读得到。 */
    private Integer isFinal;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
