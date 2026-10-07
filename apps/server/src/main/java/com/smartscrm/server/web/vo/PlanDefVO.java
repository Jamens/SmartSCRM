package com.smartscrm.server.web.vo;

/**
 * B12 模拟支付门控的预设套餐定义。仅作演示：价格与限额为写死的常量，
 * 真实计费应来自独立的订单 / 支付系统。任意 limit 为 null 表示「不限量」。
 */
public record PlanDefVO(
        String code,
        int price,
        Integer seatLimit,
        Integer aiTokenLimit,
        Integer translationCharLimit
) {
}
