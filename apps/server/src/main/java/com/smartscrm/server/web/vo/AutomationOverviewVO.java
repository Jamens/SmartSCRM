package com.smartscrm.server.web.vo;

import java.util.List;
import java.util.Map;

/**
 * B20 面板总览。账号行带"挂了几个任务"（B9 多账号已展开计数，spec §8）。
 */
public record AutomationOverviewVO(
    long accountsTotal,
    long accountsOnline,
    long tasksTotal,
    long tasksActive,
    /** 状态 → 计数（跨四类任务）。 */
    Map<String, Long> byStatus,
    /** 来源 → 计数：script/nurture/groupJoin/groupKick。 */
    Map<String, Long> byKind,
    List<AccountRowVO> accounts) {

    /** 一个账号行。 */
    public record AccountRowVO(
        Long id,
        String name,
        Integer platformType,
        boolean online,
        /** 该账号上在跑的自动化任务数（B9 多账号已展开）。 */
        int activeTasks) {
    }
}
