package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B9 互聊养号计划。多个账号进同一个群、按可复现日程轮流发言（spec §6）。
 *
 * <p>可复现三件套（spec §3）：{@code seed} 派生日程与发言顺序（不用 Math.random）、
 * {@code accountIds} 入库前已按平台分组+稳定排序、{@code lastRunDate} 记断点。
 * {@code status} 复用 batch-send 词表，多一个 {@code confirmed} 态当**人工门**。
 */
@Data
@TableName("nurture_plan")
public class NurturePlan {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    /** 目标群；createGroup=1 时可空（建完回填）。 */
    private String groupChatKey;
    private Integer createGroup;
    /** 参与账号 id 数组（JSON 文本），入库前已按平台分组+稳定排序。 */
    private String accountIds;
    private Integer perGroup;
    /** 话术池：B3 快捷回复 / B4 素材的 id（JSON 文本），不复制内容。 */
    private String materialIds;
    /** 可复现种子：日程与发言顺序全由它派生。 */
    private Long seed;
    /** 每天时间点数组（JSON 文本），如 ["09:30","20:00"]。 */
    private String atPoints;
    private Integer speakingRounds;
    private Integer intervalMinSec;
    private Integer intervalMaxSec;
    private Integer jitterPct;
    /** pending|confirmed|running|paused|done|error|cancelled。 */
    private String status;
    /** 断点：当天跑到哪个时间点，重启接着来。 */
    private LocalDate lastRunDate;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
