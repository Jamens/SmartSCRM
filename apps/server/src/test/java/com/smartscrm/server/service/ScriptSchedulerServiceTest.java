package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import com.smartscrm.server.mapper.ScriptTaskStepMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B8 P9-2 调度器单测：断点推进 / 一轮跑完重置 / failover 不重置断点 / 心跳超时。 */
class ScriptSchedulerServiceTest {

    private static final Long TENANT = 1L, TASK = 7L, PLAYBOOK = 3L;

    private ScriptTaskMapper taskMapper;
    private ScriptTaskStepMapper stepMapper;
    private ScriptPlaybookMapper playbookMapper;
    private ScriptPlaybookStepMapper pbStepMapper;
    private ScriptSchedulerService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { ScriptTask.class, ScriptTaskStep.class, ScriptPlaybook.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        taskMapper = mock(ScriptTaskMapper.class);
        stepMapper = mock(ScriptTaskStepMapper.class);
        playbookMapper = mock(ScriptPlaybookMapper.class);
        pbStepMapper = mock(ScriptPlaybookStepMapper.class);
        svc = new ScriptSchedulerService(taskMapper, stepMapper, playbookMapper, pbStepMapper);
    }

    private static ScriptTask task(String status, int currentStep, Integer attempts) {
        ScriptTask t = new ScriptTask();
        t.setId(TASK);
        t.setTenantId(TENANT);
        t.setPlaybookId(PLAYBOOK);
        t.setStatus(status);
        t.setCurrentStep(currentStep);
        t.setAttempts(attempts);
        return t;
    }

    private static ScriptTaskStep step(int seq, String status) {
        ScriptTaskStep s = new ScriptTaskStep();
        s.setId((long) seq);
        s.setTenantId(TENANT);
        s.setTaskId(TASK);
        s.setSeq(seq);
        s.setActionType("post_message");
        s.setStatus(status);
        return s;
    }

    @Test
    void advance_movesBreakpointToNextPendingAndMarksSending() {
        ScriptTask t = task("running", 0, 0);
        when(taskMapper.selectById(TASK)).thenReturn(t);
        // step0 已 success、step1 pending → 推进到 step1
        when(stepMapper.selectList(any())).thenReturn(List.of(step(0, "success"), step(1, "pending")));
        when(playbookMapper.selectById(PLAYBOOK)).thenReturn(new ScriptPlaybook());
        when(pbStepMapper.selectList(any())).thenReturn(List.of());

        boolean dispatched = svc.advance(TASK, LocalDateTime.now());

        assertTrue(dispatched);
        assertEquals(1, t.getCurrentStep(), "断点应移到 step1");
        assertEquals("running", t.getStatus());
        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        verify(stepMapper).updateById(cap.capture());
        assertEquals("sending", cap.getValue().getStatus(), "step1 应置 sending");
    }

    @Test
    void advance_skipsSending_notPending() {
        ScriptTask t = task("running", 1, 0);
        when(taskMapper.selectById(TASK)).thenReturn(t);
        // step0 success、step1 sending(正在跑不算待补)、step2 pending
        when(stepMapper.selectList(any())).thenReturn(List.of(step(0, "success"), step(1, "sending"), step(2, "pending")));
        when(playbookMapper.selectById(PLAYBOOK)).thenReturn(new ScriptPlaybook());
        when(pbStepMapper.selectList(any())).thenReturn(List.of());

        svc.advance(TASK, LocalDateTime.now());

        assertEquals(2, t.getCurrentStep(), "sending 跳过，推进到 step2");
    }

    @Test
    void advance_allDone_resetsBreakpointForNextLoop_noDispatch() {
        ScriptTask t = task("running", 2, 0);
        when(taskMapper.selectById(TASK)).thenReturn(t);
        // 本轮全 success → 一轮跑完，归零重置排下一轮，不派发新步
        when(stepMapper.selectList(any())).thenReturn(List.of(step(0, "success"), step(1, "success")));
        when(playbookMapper.selectById(PLAYBOOK)).thenReturn(new ScriptPlaybook());
        when(pbStepMapper.selectList(any())).thenReturn(List.of());

        boolean dispatched = svc.advance(TASK, LocalDateTime.now());

        assertEquals(false, dispatched, "本轮跑完不派发新步");
        assertEquals(0, t.getCurrentStep(), "断点归零");
        // success 的步被清回 pending（下一轮整体重来）
        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        verify(stepMapper, org.mockito.Mockito.atLeastOnce()).updateById(cap.capture());
        assertEquals("pending", cap.getValue().getStatus());
    }

    @Test
    void onStepFailure_belowThreshold_doesNotSwitchAccount() {
        ScriptTask t = task("running", 1, 0);
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectOne(any())).thenReturn(step(1, "sending"));

        svc.onStepResult(TASK, 1, "failed", "X", "boom", null);

        assertEquals(1, t.getAttempts(), "attempts 累加");
        assertEquals("running", t.getStatus(), "未达阈值不切号、任务仍 running");
        assertEquals(1, t.getCurrentStep(), "断点不动");
    }

    @Test
    void onStepFailure_atThreshold_failoverSwitchesAccount_notBreakpoint() {
        ScriptTask t = task("running", 1, 2); // 这次失败 attempts→3 达阈值
        t.setAccountId(7L);
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectOne(any())).thenReturn(step(1, "sending"));
        ScriptPlaybook pb = new ScriptPlaybook();
        pb.setId(PLAYBOOK);
        pb.setAccountIds("[7,2,3]"); // failover 顺序
        when(playbookMapper.selectById(PLAYBOOK)).thenReturn(pb);

        svc.onStepResult(TASK, 1, "failed", "X", "boom", null);

        assertEquals(2L, t.getAccountId(), "切到下一个账号");
        assertEquals(0, t.getAttempts(), "切号后 attempts 归零");
        assertEquals(1, t.getCurrentStep(), "failover 不重置断点");
        assertEquals("running", t.getStatus());
    }

    @Test
    void onStepFailure_accountsExhausted_marksError() {
        ScriptTask t = task("running", 1, 2);
        t.setAccountId(3L); // 已是最后一个
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectOne(any())).thenReturn(step(1, "sending"));
        ScriptPlaybook pb = new ScriptPlaybook();
        pb.setAccountIds("[7,2,3]");
        when(playbookMapper.selectById(PLAYBOOK)).thenReturn(pb);

        svc.onStepResult(TASK, 1, "failed", "X", "boom", null);

        assertEquals("error", t.getStatus(), "账号用尽判 error");
    }

    @Test
    void reapStale_heartbeatTimeout_marksError() {
        ScriptTask stale = task("running", 0, 0);
        stale.setHeartbeatAt(LocalDateTime.now().minusSeconds(600)); // 10 分钟前心跳
        when(taskMapper.selectList(any())).thenReturn(List.of(stale));

        int n = svc.reapStale(LocalDateTime.now());

        assertEquals(1, n);
        assertEquals("error", stale.getStatus(), "心跳超时判 error，不卡 running");
        assertEquals("心跳超时", stale.getLastError());
    }
}
