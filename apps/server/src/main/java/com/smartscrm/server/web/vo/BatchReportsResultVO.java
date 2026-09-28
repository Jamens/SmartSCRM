package com.smartscrm.server.web.vo;

/**
 * 状态搬完之后的权威读数：Task 12 的 host 拿它广播，渲染层只认这一份。
 * total 恒来自任务头，sent/fail 是结算后的明细计数。
 */
public record BatchReportsResultVO(int sentCount, int failCount, int totalCount, String status) {
}
