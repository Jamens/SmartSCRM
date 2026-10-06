package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import com.smartscrm.server.mapper.ScriptTaskStepMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B8 任务实例管理（起任务 / 查任务 / step 回报 / 心跳）——给 P9-3 前端与后续桌面端执行器用。
 *
 * <p>起任务按 {@code uk(tenant,playbook,target_chat_key)} 幂等：同一群对同一剧本重复起任务会返回
 * 已存在的那条（loop 会反复扫，重建会产生 N 个重复任务）。首次起任务时按剧本步骤**预建**全部
 * script_task_step（pending），断点续跑才有逐格可查的落点。
 */
@Service
public class ScriptTaskService {

    private final ScriptTaskMapper taskMapper;
    private final ScriptTaskStepMapper stepMapper;
    private final ScriptPlaybookMapper playbookMapper;
    private final ScriptPlaybookStepMapper playbookStepMapper;
    private final ScriptSchedulerService scheduler;

    public ScriptTaskService(ScriptTaskMapper taskMapper, ScriptTaskStepMapper stepMapper,
                             ScriptPlaybookMapper playbookMapper, ScriptPlaybookStepMapper playbookStepMapper,
                             ScriptSchedulerService scheduler) {
        this.taskMapper = taskMapper;
        this.stepMapper = stepMapper;
        this.playbookMapper = playbookMapper;
        this.playbookStepMapper = playbookStepMapper;
        this.scheduler = scheduler;
    }

    /** 起一个任务（对某群跑某剧本）。幂等：同群同剧本已存在则原样返回。 */
    @Transactional
    public ScriptTask start(Long tenantId, Long playbookId, String targetChatKey, String targetGroupId) {
        if (targetChatKey == null || targetChatKey.isBlank()) {
            throw new BizException(40000, "targetChatKey 不能为空");
        }
        ScriptPlaybook pb = playbookMapper.selectById(playbookId);
        if (pb == null || !tenantId.equals(pb.getTenantId())) {
            throw new BizException(40404, "剧本不存在: " + playbookId);
        }
        // 幂等：同群同剧本已存在 → 直接返回，不重建
        ScriptTask exist = taskMapper.selectOne(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getTenantId, tenantId).eq(ScriptTask::getPlaybookId, playbookId)
            .eq(ScriptTask::getTargetChatKey, targetChatKey).last("LIMIT 1"));
        if (exist != null) {
            return exist;
        }
        LocalDateTime now = LocalDateTime.now();
        ScriptTask t = new ScriptTask();
        t.setTenantId(tenantId);
        t.setPlaybookId(playbookId);
        // 初始账号 = 剧本 failover 列表的第一个
        List<Long> acct = parseIds(pb.getAccountIds());
        t.setAccountId(acct.isEmpty() ? null : acct.get(0));
        t.setTargetChatKey(targetChatKey.trim());
        t.setTargetGroupId(targetGroupId);
        t.setStatus("pending");
        t.setCurrentStep(0);
        t.setAttempts(0);
        t.setNextRunAt(now); // 立即到期，交给调度器首推
        t.setHeartbeatAt(now);
        taskMapper.insert(t);
        // 预建全部 step（pending），断点续跑才有逐格落点
        List<ScriptPlaybookStep> defs = playbookStepMapper.selectList(
            new LambdaQueryWrapper<ScriptPlaybookStep>().eq(ScriptPlaybookStep::getPlaybookId, playbookId)
                .orderByAsc(ScriptPlaybookStep::getSeq));
        for (ScriptPlaybookStep d : defs) {
            ScriptTaskStep s = new ScriptTaskStep();
            s.setTenantId(tenantId);
            s.setTaskId(t.getId());
            s.setSeq(d.getSeq());
            s.setActionType(d.getActionType());
            s.setStatus("pending");
            stepMapper.insert(s);
        }
        return t;
    }

    public List<ScriptTask> list(Long tenantId, Long playbookId) {
        return taskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getTenantId, tenantId)
            .eq(playbookId != null, ScriptTask::getPlaybookId, playbookId)
            .orderByDesc(ScriptTask::getId));
    }

    public List<ScriptTaskStep> listSteps(Long tenantId, Long taskId) {
        get(tenantId, taskId);
        return stepMapper.selectList(new LambdaQueryWrapper<ScriptTaskStep>()
            .eq(ScriptTaskStep::getTenantId, tenantId).eq(ScriptTaskStep::getTaskId, taskId)
            .orderByAsc(ScriptTaskStep::getSeq));
    }

    /** 手动触发一次推进（前端「立即跑一步」/测试用）。 */
    @Transactional
    public boolean advanceNow(Long tenantId, Long taskId) {
        get(tenantId, taskId);
        return scheduler.advance(taskId, LocalDateTime.now());
    }

    /** 桌面端/前端回报某步结果。 */
    @Transactional
    public void reportStep(Long tenantId, Long taskId, int seq, String status, String errorCode, String errorDetail, String msgKey) {
        get(tenantId, taskId);
        scheduler.onStepResult(taskId, seq, status, errorCode, errorDetail, msgKey);
    }

    /** 心跳。 */
    @Transactional
    public void heartbeat(Long tenantId, Long taskId) {
        get(tenantId, taskId);
        scheduler.heartbeat(taskId);
    }

    @Transactional
    public void cancel(Long tenantId, Long taskId) {
        ScriptTask t = get(tenantId, taskId);
        t.setStatus("cancelled");
        taskMapper.updateById(t);
    }

    private ScriptTask get(Long tenantId, Long id) {
        ScriptTask t = taskMapper.selectById(id);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "任务不存在: " + id);
        return t;
    }

    private static List<Long> parseIds(String json) {
        try {
            if (json == null) return List.of();
            String body = json.trim();
            if (body.startsWith("[") && body.endsWith("]")) body = body.substring(1, body.length() - 1);
            if (body.isBlank()) return List.of();
            List<Long> out = new java.util.ArrayList<>();
            for (String p : body.split(",")) {
                String s = p.trim();
                if (!s.isEmpty()) out.add(Long.parseLong(s));
            }
            return out;
        } catch (RuntimeException e) {
            return List.of();
        }
    }
}
