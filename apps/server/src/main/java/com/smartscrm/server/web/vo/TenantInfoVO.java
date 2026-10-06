package com.smartscrm.server.web.vo;

/**
 * B24 首页「套餐信息卡 / 用量统计卡」所需的最小租户快照。
 * 席位已用数由前端用 /api/dashboard/overview 的 accountsTotal 合并，这里只回写上限与用量字段。
 * 任意 limit 为 null 表示「不限量」。
 */
public record TenantInfoVO(
        String name,
        String planName,
        Integer seatLimit,
        Integer aiTokenLimit,
        Integer aiTokenUsed,
        Integer translationCharLimit,
        Integer translationCharUsed
) {
}
