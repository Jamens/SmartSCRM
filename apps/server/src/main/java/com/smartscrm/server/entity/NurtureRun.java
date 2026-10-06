package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B9 养号发言执行记录。一次「某账号在某时间点某轮该发言」= 一行。
 *
 * <p>{@code uk(plan,at,round,account)} 幂等——tick 每 10s 跑一次，没这道唯一键会重复发言。
 * {@code slotIndex} 是由 plan.seed 派生的可复现序号，用于算可复现发言间隔。
 */
@Data
@TableName("nurture_run")
public class NurtureRun {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long planId;
    /** 哪个账号发（= 哪个 view）。 */
    private Long accountId;
    /** HH:mm。 */
    private String atPoint;
    /** 该时间点内第几轮，从 0 起。 */
    private Integer roundIdx;
    /** 可复现派发序号，算间隔用。 */
    private Integer slotIndex;
    /** 实际发出的正文（快照，便于回看）。 */
    private String text;
    /** pending|sending|success|failed|skipped。 */
    private String status;
    private String msgKey;
    private String errorDetail;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
