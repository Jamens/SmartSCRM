package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B23 客户跟进记录。一次跟进 = 一条记录，挂在客户下（spec：客户跟进记录 + 统计卡 / 批量操作条）。
 *
 * <p>{@code remindAt} 是「下次跟进提醒时间」，可为空；统计卡的「待跟进」即按它统计。
 */
@Data
@TableName("customer_follow_up")
public class CustomerFollowUp {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 所属客户。 */
    private Long customerId;
    /** note / call / email / meeting / other。 */
    private String type;
    /** 跟进内容。 */
    private String content;
    /** 下次跟进提醒时间（可为空）。 */
    private LocalDateTime remindAt;
    /** 操作人标识（用户 id；AuthPrincipal 不带用户名，够回溯「谁做的」即可，可为空）。 */
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
