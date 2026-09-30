package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * 群成员状态快照（V12 / spec §3）。
 *
 * 这张表同时是**后续群运营阶段的目标池契约**（spec §11）：列改名、语义变化、判退口径调整
 * 在本期交付后都属破坏性改动。
 *
 * 两列最容易误用，区别写在这里：
 * <ul>
 *   <li>{@code latestJoinAt} —— 进群时间，唯一来源是事件。快照写不出它。</li>
 *   <li>{@code firstSeenAt} —— 本应用第一次看见这个人，不是进群时间。快照建档的人只有这一个值。</li>
 * </ul>
 * 拿建档时刻去填 {@code latestJoinAt}，等于造一条查不出来源的假记录。
 */
@Data
@TableName("group_member_state")
public class GroupMemberState {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    /** WA: {@code 8613xxx@c.us}。 */
    private String memberKey;
    private String phone;
    private String displayName;
    /** member | admin | super。 */
    private String roleType;
    private Integer isInGroup;
    private Integer joinCount;
    /** 被快照推定退群的人这一列恒为 NULL；非空只意味着"有事件证据"。 */
    private LocalDateTime latestJoinAt;
    private LocalDateTime latestLeaveAt;
    /** left | removed | snapshot_absent。 */
    private String exitMethod;
    private LocalDateTime lastEventAt;
    /** 本应用第一次看见他，不是进群时间。 */
    private LocalDateTime firstSeenAt;
    /** 第几次成功快照里还看见他。 */
    private Integer snapshotSeenCount;
    private Long customerId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
