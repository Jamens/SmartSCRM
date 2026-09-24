package com.smartscrm.server.web.vo;

/**
 * 租户级未读汇总（任务栏角标的数据源）。
 * <p>
 * {@code total} 是所有会话头未读数之和；{@code conversations} 是其中还有未读的会话条数。
 * 两个数一起给，"0" 才有两种读法：会话数为 0 是还没采集过，会话数 &gt; 0 而总量为 0 是都读完了。
 * 角标只吃 {@code total}。
 */
public record UnreadTotalVO(long total, long conversations) {}
