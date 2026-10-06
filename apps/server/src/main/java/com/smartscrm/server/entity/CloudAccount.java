package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B21 云账号池 · 云账号（spec §2）。
 *
 * <p>v1 覆盖：分组（{@code groupId}）、状态（供统计卡与筛选）、批量转移、同步到本地。
 * <strong>开源红线</strong>：「同步到本地」只是把云号落成一条本地 {@code platform_account} 记录
 * （{@code syncedAccountId} 回写），由部署方自托管号源后自行对接；本仓不连任何真实云号服务、
 * 不发起任何外连，与 B10 模拟拉流 / B13 模拟出口探测 / B14 模拟生成指纹同口径。
 */
@Data
@TableName("cloud_account")
public class CloudAccount {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 所属分组（cloud_account_group.id），为空表示未分组。 */
    private Long groupId;
    /** 云号别名。 */
    private String name;
    /** 绑定号码。 */
    private String phone;
    /** whatsapp / telegram / line。 */
    private String platform;
    /** online / offline / warming / banned（统计卡与筛选用）。 */
    private String status;
    /** 上次同步到本地的时间。 */
    private LocalDateTime syncedAt;
    /** 同步生成的本地账号 id（platform_account.id）。 */
    private Long syncedAccountId;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
