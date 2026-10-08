package com.smartscrm.server.web.vo;

/**
 * 删除平台账号会被 {@code ON DELETE CASCADE} 带走的行数（累计，不是时间窗）。
 *
 * <p>五个字段与五张表一一对应：{@code chat_conversation} / {@code chat_message}（V8）、
 * {@code chat_group} / {@code group_member_state} / {@code group_member_event}（V12）。
 * 字段名即 JSON 键名，渲染层 {@code lib/accountImpact.ts} 按同一组键读——加一张 CASCADE 表时
 * 两边都要动，那边有一条单测钉着这份名单。
 */
public record AccountImpactVO(
    long conversations,
    long messages,
    long groups,
    long memberStates,
    long memberEvents
) {
}
