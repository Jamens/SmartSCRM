package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupJoinItem;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.mapper.GroupJoinItemMapper;
import com.smartscrm.server.mapper.GroupJoinTaskMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B18 群自动加群 · 数据层（租户隔离）。
 *
 * <p>**人工门**：建任务后 status=pending，必须显式 {@link #confirm} 成 confirmed 才允许执行
 * （执行链入口会用 {@link #requireConfirmed} 再判一次，见 spec §5——门不只靠 UI 挡）。
 * 加错群只能退群，不可逆，所以这道门是硬约束。
 */
@Service
public class GroupJoinService {

    private static final int MAX_CODES = 2000;

    private final GroupJoinTaskMapper taskMapper;
    private final GroupJoinItemMapper itemMapper;

    public GroupJoinService(GroupJoinTaskMapper taskMapper, GroupJoinItemMapper itemMapper) {
        this.taskMapper = taskMapper;
        this.itemMapper = itemMapper;
    }

    /** 建加群任务并导入邀请码明细（去重）。status=pending，等人工确认。 */
    @Transactional
    public GroupJoinTask create(Long tenantId, Long accountId, String name, String rawCodes,
                                Integer minSec, Integer maxSec, Integer jitterPct) {
        if (accountId == null) throw new BizException(40000, "accountId 不能为空");
        List<String> codes = splitCodes(rawCodes);
        if (codes.isEmpty()) throw new BizException(40000, "邀请码不能为空");
        if (codes.size() > MAX_CODES) throw new BizException(40000, "单任务邀请码上限 " + MAX_CODES + "，当前 " + codes.size());
        int lo = minSec == null ? 60 : Math.max(1, minSec);
        int hi = maxSec == null ? 120 : Math.max(1, maxSec);
        if (lo > hi) { int t = lo; lo = hi; hi = t; }

        GroupJoinTask t = new GroupJoinTask();
        t.setTenantId(tenantId);
        t.setAccountId(accountId);
        t.setName(name == null || name.isBlank() ? "加群任务" : name.trim());
        t.setStatus("pending");
        t.setIntervalMinSec(lo);
        t.setIntervalMaxSec(hi);
        t.setJitterPct(jitterPct == null ? 20 : Math.min(100, Math.max(0, jitterPct)));
        t.setTotal(codes.size());
        t.setSucceeded(0);
        t.setFailed(0);
        taskMapper.insert(t);
        for (String c : codes) {
            GroupJoinItem i = new GroupJoinItem();
            i.setTenantId(tenantId);
            i.setTaskId(t.getId());
            i.setInviteCode(c);
            i.setStatus("pending");
            itemMapper.insert(i);
        }
        return t;
    }

    public List<GroupJoinTask> list(Long tenantId) {
        return taskMapper.selectList(new LambdaQueryWrapper<GroupJoinTask>()
            .eq(GroupJoinTask::getTenantId, tenantId).orderByDesc(GroupJoinTask::getId));
    }

    public GroupJoinTask get(Long tenantId, Long id) {
        GroupJoinTask t = taskMapper.selectById(id);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "加群任务不存在: " + id);
        return t;
    }

    public List<GroupJoinItem> listItems(Long tenantId, Long taskId) {
        get(tenantId, taskId);
        return itemMapper.selectList(new LambdaQueryWrapper<GroupJoinItem>()
            .eq(GroupJoinItem::getTenantId, tenantId).eq(GroupJoinItem::getTaskId, taskId)
            .orderByAsc(GroupJoinItem::getId));
    }

    /** 人工门：确认任务。pending → confirmed。 */
    @Transactional
    public GroupJoinTask confirm(Long tenantId, Long id) {
        GroupJoinTask t = get(tenantId, id);
        if (!"pending".equals(t.getStatus())) {
            throw new BizException(40000, "只有 pending 任务可确认，当前: " + t.getStatus());
        }
        t.setStatus("confirmed");
        taskMapper.updateById(t);
        return t;
    }

    /**
     * 执行链入口的**人工门校验**（spec §5）：非 confirmed 一律拒绝。
     * 刻意做成 public 静态方法，让执行器（Java 侧或桌面端回报路径）能直接调用同一份判定，
     * 避免"UI 挡了一道、执行链忘了再挡一道"。
     */
    public static void requireConfirmed(GroupJoinTask t) {
        if (t == null || !"confirmed".equals(t.getStatus())) {
            throw new BizException(40301, "任务未经人工确认，禁止执行（需 confirmed）");
        }
    }

    @Transactional
    public void cancel(Long tenantId, Long id) {
        GroupJoinTask t = get(tenantId, id);
        t.setStatus("cancelled");
        taskMapper.updateById(t);
    }

    /** 邀请码导入：每行一个，兼容逗号/分号/空白分隔；去空去重。 */
    private static List<String> splitCodes(String raw) {
        if (raw == null) return List.of();
        java.util.LinkedHashSet<String> seen = new java.util.LinkedHashSet<>();
        for (String line : raw.split("[\r\n,;\\s]+")) {
            String c = line.trim();
            if (!c.isEmpty()) seen.add(c);
        }
        return List.copyOf(seen);
    }
}
