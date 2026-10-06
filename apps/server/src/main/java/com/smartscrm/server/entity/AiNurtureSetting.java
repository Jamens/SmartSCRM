package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** B28 养号设置：按租户一份（uk(tenant_id)），存推荐口径与触达参数。 */
@Data
@TableName("ai_nurture_setting")
public class AiNurtureSetting {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 每日主动触达上限，0=不限。 */
    private Integer dailyLimit;
    /** 主动/被动比例（百分数）。 */
    private Integer activeRatio;
    /** 静默时段，如 22:00-08:00。 */
    private String quietHours;
    /** conservative | balanced | aggressive。 */
    private String recommend;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
