package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupKickItem;
import com.smartscrm.server.entity.GroupKickTask;
import com.smartscrm.server.mapper.GroupKickItemMapper;
import com.smartscrm.server.mapper.GroupKickTaskMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B19 群自动踢人 · 数据层（租户隔离）。
 *
 * <p>**两道门**（spec §5）：
 * <ol>
 *   <li>人工门 {@code approvalStatus}：规则出名单是 pending，人工审阅才 approved；执行链入口
 *       用 {@link #requireApproved} 再判一次。</li>
 *   <li>能力门 {@code canRemove}：即使 approved，canRemove=false 的成员也只标 skipped 不硬踢
 *       （踢超管/踢自己不可逆）。</li>
 * </ol>
 */
@Service
public class GroupKickService {

    private static final int MAX_ITEMS = 5000;

    private final GroupKickTaskMapper taskMapper;
    private final GroupKickItemMapper itemMapper;

    public GroupKickService(GroupKickTaskMapper taskMapper, GroupKickItemMapper itemMapper) {
        this.taskMapper = taskMapper;
        this.itemMapper = itemMapper;
    }

    /** 建踢人任务并导入待踢名单。approvalStatus=pending，等人工审阅。 */
    @Transactional
    public GroupKickTask create(Long tenantId, Long accountId, String groupId, String name,
                                String rule, List<String> participantIds) {
        if (accountId == null) throw new BizException(40000, "accountId 不能为空");
        if (groupId == null || groupId.isBlank()) throw new BizException(40000, "groupId 不能为空");
        if (participantIds == null || participantIds.isEmpty()) throw new BizException(40000, "待踢名单不能为空");
        if (participantIds.size() > MAX_ITEMS) {
            throw new BizException(40000, "单任务名单上限 " + MAX_ITEMS + "，当前 " + participantIds.size());
        }
        GroupKickTask t = new GroupKickTask();
        t.setTenantId(tenantId);
        t.setAccountId(accountId);
        t.setGroupId(groupId.trim());
        t.setName(name == null || name.isBlank() ? "踢人任务" : name.trim());
        t.setStatus("pending");
        t.setApprovalStatus("pending"); // 人工门：建完一律 pending，人工审阅后才 approved
        t.setRule(rule);
        t.setTotal(participantIds.size());
        t.setSucceeded(0);
        t.setFailed(0);
        taskMapper.insert(t);
        java.util.LinkedHashSet<String> seen = new java.util.LinkedHashSet<>();
        for (String pid : participantIds) {
            if (pid == null || pid.isBlank()) continue;
            if (!seen.add(pid.trim())) continue; // uk(task_id, participant_id) 幂等
            GroupKickItem i = new GroupKickItem();
            i.setTenantId(tenantId);
            i.setTaskId(t.getId());
            i.setParticipantId(pid.trim());
            i.setStatus("pending");
            itemMapper.insert(i);
        }
        return t;
    }

    public List<GroupKickTask> list(Long tenantId) {
        return taskMapper.selectList(new LambdaQueryWrapper<GroupKickTask>()
            .eq(GroupKickTask::getTenantId, tenantId).orderByDesc(GroupKickTask::getId));
    }

    public GroupKickTask get(Long tenantId, Long id) {
        GroupKickTask t = taskMapper.selectById(id);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "踢人任务不存在: " + id);
        return t;
    }

    public List<GroupKickItem> listItems(Long tenantId, Long taskId) {
        get(tenantId, taskId);
        return itemMapper.selectList(new LambdaQueryWrapper<GroupKickItem>()
            .eq(GroupKickItem::getTenantId, tenantId).eq(GroupKickItem::getTaskId, taskId)
            .orderByAsc(GroupKickItem::getId));
    }

    /** 人工门：审阅通过。pending → approved。 */
    @Transactional
    public GroupKickTask approve(Long tenantId, Long id) {
        GroupKickTask t = get(tenantId, id);
        if (!"pending".equals(t.getApprovalStatus())) {
            throw new BizException(40000, "只有待审阅任务可批准，当前: " + t.getApprovalStatus());
        }
        t.setApprovalStatus("approved");
        taskMapper.updateById(t);
        return t;
    }

    /** 人工门：审阅驳回。pending → rejected。 */
    @Transactional
    public GroupKickTask reject(Long tenantId, Long id) {
        GroupKickTask t = get(tenantId, id);
        if (!"pending".equals(t.getApprovalStatus())) {
            throw new BizException(40000, "只有待审阅任务可驳回，当前: " + t.getApprovalStatus());
        }
        t.setApprovalStatus("rejected");
        taskMapper.updateById(t);
        return t;
    }

    /**
     * 执行链入口的**人工门校验**（spec §5）：只有 approved 能执行。
     * 与 {@link #requireConfirmed} 同一个思路——门在执行链再判一次，不只靠 UI。
     */
    public static void requireApproved(GroupKickTask t) {
        if (t == null || !"approved".equals(t.getApprovalStatus())) {
            throw new BizException(40301, "名单未经人工审阅，禁止执行（需 approved）");
        }
    }

    /**
     * 能力门：单条该不该真踢。canRemove 非明确 true 一律 skip——
     * 踢超管/踢自己不可逆，未校验 ≠ 允许。
     */
    public static boolean shouldKick(Boolean canRemove) {
        return Boolean.TRUE.equals(canRemove);
    }

    @Transactional
    public void cancel(Long tenantId, Long id) {
        GroupKickTask t = get(tenantId, id);
        t.setStatus("cancelled");
        taskMapper.updateById(t);
    }
}
