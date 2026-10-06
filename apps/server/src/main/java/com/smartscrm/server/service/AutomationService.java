package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.entity.GroupKickTask;
import com.smartscrm.server.entity.NurturePlan;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.mapper.GroupJoinTaskMapper;
import com.smartscrm.server.mapper.GroupKickTaskMapper;
import com.smartscrm.server.mapper.NurturePlanMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import com.smartscrm.server.web.vo.AutomationOverviewVO;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B20 自动化任务面板 · 跨模块聚合 + 账号批量操作（spec §3/§4/§5）。
 *
 * <p><b>只读聚合，不新增任务表</b>：状态计数来自 B8/B9/B18/B19 各自的表，模块改词表这里跟着改。
 *
 * <p><b>停/删一律调各模块 Service 的 cancel</b>，**不直接 UPDATE 别人的表**——保持各自的人工门
 * 与状态机不被绕过（spec §3）。
 *
 * <p><b>删除/关闭前先停任务</b>（spec §5）：账号上可能挂着被 {@code @Scheduled} 驱动的任务，
 * 不先停就会对不存在的 view 派发。
 */
@Service
public class AutomationService {

    /** 终态：不该再视为"在跑"。与各模块词表一致。 */
    private static final Set<String> TERMINAL = Set.of("done", "error", "cancelled");

    private final PlatformAccountMapper accountMapper;
    private final ScriptTaskMapper scriptTaskMapper;
    private final NurturePlanMapper nurturePlanMapper;
    private final GroupJoinTaskMapper joinTaskMapper;
    private final GroupKickTaskMapper kickTaskMapper;
    private final ScriptTaskService scriptTaskService;
    private final NurturePlanService nurturePlanService;
    private final GroupJoinService groupJoinService;
    private final GroupKickService groupKickService;

    public AutomationService(PlatformAccountMapper accountMapper, ScriptTaskMapper scriptTaskMapper,
                             NurturePlanMapper nurturePlanMapper, GroupJoinTaskMapper joinTaskMapper,
                             GroupKickTaskMapper kickTaskMapper, ScriptTaskService scriptTaskService,
                             NurturePlanService nurturePlanService, GroupJoinService groupJoinService,
                             GroupKickService groupKickService) {
        this.accountMapper = accountMapper;
        this.scriptTaskMapper = scriptTaskMapper;
        this.nurturePlanMapper = nurturePlanMapper;
        this.joinTaskMapper = joinTaskMapper;
        this.kickTaskMapper = kickTaskMapper;
        this.scriptTaskService = scriptTaskService;
        this.nurturePlanService = nurturePlanService;
        this.groupJoinService = groupJoinService;
        this.groupKickService = groupKickService;
    }

    /** 状态总览：账号汇总 + 四类任务状态计数 + 每账号挂的任务数。 */
    public AutomationOverviewVO overview(Long tenantId) {
        List<PlatformAccount> accounts = listAccounts(tenantId);
        long online = accounts.stream().filter(a -> a.getStatus() != null && a.getStatus() == 1).count();

        List<TaskRef> refs = loadTaskRefs(tenantId);
        // 每账号挂的任务数：B9 是多账号，account_ids 展开（spec §8）
        Map<Long, Integer> perAccount = new LinkedHashMap<>();
        for (PlatformAccount a : accounts) perAccount.put(a.getId(), 0);
        for (TaskRef r : refs) {
            for (Long acct : r.accountIds()) {
                perAccount.merge(acct, 1, Integer::sum);
            }
        }

        Map<String, Long> byStatus = new LinkedHashMap<>();
        Map<String, Long> byKind = new LinkedHashMap<>();
        for (TaskRef r : refs) {
            byStatus.merge(r.status(), 1L, Long::sum);
            byKind.merge(r.kind(), 1L, Long::sum);
        }
        long active = refs.stream().filter(r -> !TERMINAL.contains(r.status())).count();

        List<AutomationOverviewVO.AccountRowVO> rows = new ArrayList<>();
        for (PlatformAccount a : accounts) {
            rows.add(new AutomationOverviewVO.AccountRowVO(
                a.getId(), a.getName(), a.getPlatformType(),
                a.getStatus() != null && a.getStatus() == 1,
                perAccount.getOrDefault(a.getId(), 0)));
        }
        return new AutomationOverviewVO(accounts.size(), online, refs.size(), active, byStatus, byKind, rows);
    }

    /**
     * 批量关闭：停账号 + 停其上在跑任务（可恢复，不删数据）。
     * @return 停掉的任务数（让操作者知情）
     */
    @Transactional
    public int closeAccounts(Long tenantId, List<Long> accountIds) {
        List<Long> ids = requireIds(accountIds);
        for (Long id : ids) {
            ensureOwned(tenantId, id);
            stopTasksOf(tenantId, id);
            accountMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<PlatformAccount>()
                .eq(PlatformAccount::getId, id).set(PlatformAccount::getStatus, 0));
        }
        return countActiveOf(tenantId, ids);
    }

    /**
     * 批量删除：**先停任务再删账号**（spec §5）。删账号不先停 → 孤儿任务对着不存在的 view 派发。
     * @return 停掉的任务数（删完后已无任务，返回停掉的数量供展示）
     */
    @Transactional
    public int deleteAccounts(Long tenantId, List<Long> accountIds) {
        List<Long> ids = requireIds(accountIds);
        int stopped = 0;
        for (Long id : ids) {
            ensureOwned(tenantId, id);
            stopped += stopTasksOf(tenantId, id);
        }
        for (Long id : ids) {
            accountMapper.deleteById(id);
        }
        return stopped;
    }

    // ============ 内部 ============

    /** 内部任务引用（已把"属于谁"归一：accountIds 恒为数组，spec §8）。 */
    record TaskRef(String kind, Long id, String status, List<Long> accountIds) {}

    private List<PlatformAccount> listAccounts(Long tenantId) {
        return accountMapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId).orderByAsc(PlatformAccount::getId));
    }

    private List<TaskRef> loadTaskRefs(Long tenantId) {
        List<TaskRef> refs = new ArrayList<>();
        for (ScriptTask t : scriptTaskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getTenantId, tenantId))) {
            refs.add(new TaskRef("script", t.getId(), t.getStatus(),
                t.getAccountId() == null ? List.of() : List.of(t.getAccountId())));
        }
        for (NurturePlan p : nurturePlanMapper.selectList(new LambdaQueryWrapper<NurturePlan>()
            .eq(NurturePlan::getTenantId, tenantId))) {
            refs.add(new TaskRef("nurture", p.getId(), p.getStatus(), parseIds(p.getAccountIds())));
        }
        for (GroupJoinTask t : joinTaskMapper.selectList(new LambdaQueryWrapper<GroupJoinTask>()
            .eq(GroupJoinTask::getTenantId, tenantId))) {
            refs.add(new TaskRef("groupJoin", t.getId(), t.getStatus(),
                t.getAccountId() == null ? List.of() : List.of(t.getAccountId())));
        }
        for (GroupKickTask t : kickTaskMapper.selectList(new LambdaQueryWrapper<GroupKickTask>()
            .eq(GroupKickTask::getTenantId, tenantId))) {
            refs.add(new TaskRef("groupKick", t.getId(), t.getStatus(),
                t.getAccountId() == null ? List.of() : List.of(t.getAccountId())));
        }
        return refs;
    }

    /** 停某账号上所有在跑任务（调各模块 Service，不直接改表）。@return 停掉的数量 */
    private int stopTasksOf(Long tenantId, Long accountId) {
        int stopped = 0;
        for (ScriptTask t : scriptTaskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getTenantId, tenantId).eq(ScriptTask::getAccountId, accountId))) {
            if (!TERMINAL.contains(t.getStatus())) { scriptTaskService.cancel(tenantId, t.getId()); stopped++; }
        }
        for (NurturePlan p : nurturePlanMapper.selectList(new LambdaQueryWrapper<NurturePlan>()
            .eq(NurturePlan::getTenantId, tenantId))) {
            if (TERMINAL.contains(p.getStatus())) continue;
            if (parseIds(p.getAccountIds()).contains(accountId)) { nurturePlanService.cancel(tenantId, p.getId()); stopped++; }
        }
        for (GroupJoinTask t : joinTaskMapper.selectList(new LambdaQueryWrapper<GroupJoinTask>()
            .eq(GroupJoinTask::getTenantId, tenantId).eq(GroupJoinTask::getAccountId, accountId))) {
            if (!TERMINAL.contains(t.getStatus())) { groupJoinService.cancel(tenantId, t.getId()); stopped++; }
        }
        for (GroupKickTask t : kickTaskMapper.selectList(new LambdaQueryWrapper<GroupKickTask>()
            .eq(GroupKickTask::getTenantId, tenantId).eq(GroupKickTask::getAccountId, accountId))) {
            if (!TERMINAL.contains(t.getStatus())) { groupKickService.cancel(tenantId, t.getId()); stopped++; }
        }
        return stopped;
    }

    private int countActiveOf(Long tenantId, List<Long> accountIds) {
        int n = 0;
        for (Long id : accountIds) n += stopTasksOfQuiet(tenantId, id);
        return n;
    }

    private int stopTasksOfQuiet(Long tenantId, Long accountId) {
        // 关闭路径上任务已停过，这里只统计"仍非终态"用于返回；避免重复 cancel
        int n = 0;
        for (ScriptTask t : scriptTaskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getTenantId, tenantId).eq(ScriptTask::getAccountId, accountId))) {
            if (!TERMINAL.contains(t.getStatus())) n++;
        }
        return n;
    }

    private void ensureOwned(Long tenantId, Long id) {
        PlatformAccount a = accountMapper.selectById(id);
        if (a == null || !tenantId.equals(a.getTenantId())) throw new BizException(40404, "账号不存在: " + id);
    }

    private static List<Long> requireIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) throw new BizException(40000, "请先选择账号");
        return ids;
    }

    /** 解析 account_ids JSON 数组（B9 多账号）。 */
    static List<Long> parseIds(String json) {
        List<Long> out = new ArrayList<>();
        if (json == null) return out;
        String body = json.trim();
        if (body.startsWith("[") && body.endsWith("]")) body = body.substring(1, body.length() - 1);
        if (body.isBlank()) return out;
        for (String s : body.split(",")) {
            String x = s.trim().replace("\"", "");
            if (x.isEmpty()) continue;
            try {
                out.add(Long.parseLong(x));
            } catch (NumberFormatException ignored) {
                // 脏数据跳过
            }
        }
        return out;
    }
}
