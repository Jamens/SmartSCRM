package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.entity.GroupKickTask;
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
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B8 剧本委托 B18/B19：委托即完成 + 留 ref + 缺参数判 failed。 */
class ScriptDelegationTest {

    private static final Long TENANT = 1L, TASK = 5L;

    private ScriptTaskMapper taskMapper;
    private ScriptTaskStepMapper stepMapper;
    private ScriptPlaybookMapper pbMapper;
    private ScriptPlaybookStepMapper pbStepMapper;
    private GroupJoinService joinService;
    private GroupKickService kickService;
    private ScriptSchedulerService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { ScriptTask.class, ScriptTaskStep.class, ScriptPlaybook.class,
            ScriptPlaybookStep.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        taskMapper = mock(ScriptTaskMapper.class);
        stepMapper = mock(ScriptTaskStepMapper.class);
        pbMapper = mock(ScriptPlaybookMapper.class);
        pbStepMapper = mock(ScriptPlaybookStepMapper.class);
        joinService = mock(GroupJoinService.class);
        kickService = mock(GroupKickService.class);
        svc = new ScriptSchedulerService(taskMapper, stepMapper, pbMapper, pbStepMapper, joinService, kickService);
    }

    private static ScriptTask task() {
        ScriptTask t = new ScriptTask();
        t.setId(TASK);
        t.setTenantId(TENANT);
        t.setPlaybookId(3L);
        t.setAccountId(7L);
        t.setStatus("running");
        t.setCurrentStep(0);
        t.setTargetChatKey("fallback@c.us");
        t.setTargetGroupId("grp@g.us");
        return t;
    }

    private static ScriptTaskStep row(String action) {
        ScriptTaskStep r = new ScriptTaskStep();
        r.setId(9L);
        r.setTenantId(TENANT);
        r.setTaskId(TASK);
        r.setSeq(0);
        r.setActionType(action);
        r.setStatus("pending");
        return r;
    }

    private static ScriptPlaybookStep def(String action, String params) {
        ScriptPlaybookStep d = new ScriptPlaybookStep();
        d.setSeq(0);
        d.setActionType(action);
        d.setParams(params);
        return d;
    }

    // ===== join_group 委托 =====

    @Test
    void advance_joinGroup_delegatesAndMarksSuccess() {
        ScriptTask t = task();
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectList(any())).thenReturn(List.of(row("join_group")));
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def("join_group", "{\"inviteCode\":\"CODE1\"}")));
        GroupJoinTask jt = new GroupJoinTask();
        jt.setId(77L);
        when(joinService.create(anyLong(), anyLong(), anyString(), anyString(), any(), any(), any())).thenReturn(jt);

        boolean advanced = svc.advance(TASK, LocalDateTime.now());

        assertTrue(advanced);
        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        // 补行 + 委托后回填，两次 updateById；取最后一次状态
        verify(stepMapper, org.mockito.Mockito.atLeastOnce()).updateById(cap.capture());
        ScriptTaskStep last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertEquals("success", last.getStatus(), "委托即完成：建完任务即 success");
        assertEquals("join", last.getRefType());
        assertEquals(77L, last.getRefId());
        // 新建的 B18 任务是 pending（人工门未过）——委托不绕过门
        verify(joinService).create(eq(TENANT), eq(7L), anyString(), eq("CODE1"), any(), any(), any());
    }

    @Test
    void advance_joinGroup_fallsBackToTargetChatKeyWhenNoInviteCode() {
        ScriptTask t = task();
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectList(any())).thenReturn(List.of(row("join_group")));
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def("join_group", null)));
        GroupJoinTask jt = new GroupJoinTask();
        jt.setId(78L);
        when(joinService.create(anyLong(), anyLong(), anyString(), anyString(), any(), any(), any())).thenReturn(jt);
        svc.advance(TASK, LocalDateTime.now());
        verify(joinService).create(eq(TENANT), eq(7L), anyString(), eq("fallback@c.us"), any(), any(), any());
    }

    // ===== kick_member 委托 =====

    @Test
    void advance_kickMember_delegatesWithRoster() {
        ScriptTask t = task();
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectList(any())).thenReturn(List.of(row("kick_member")));
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def("kick_member", "{\"participantIds\":[\"a@c.us\",\"b@c.us\"]}")));
        GroupKickTask kt = new GroupKickTask();
        kt.setId(88L);
        when(kickService.create(anyLong(), anyLong(), any(), any(), any(), any())).thenReturn(kt);

        svc.advance(TASK, LocalDateTime.now());

        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        verify(stepMapper, org.mockito.Mockito.atLeastOnce()).updateById(cap.capture());
        ScriptTaskStep last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertEquals("success", last.getStatus());
        assertEquals("kick", last.getRefType());
        assertEquals(88L, last.getRefId());
    }

    @Test
    void advance_kickMember_withoutRoster_marksFailed() {
        ScriptTask t = task();
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectList(any())).thenReturn(List.of(row("kick_member")));
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def("kick_member", "{}")));
        svc.advance(TASK, LocalDateTime.now());
        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        verify(stepMapper, org.mockito.Mockito.atLeastOnce()).updateById(cap.capture());
        ScriptTaskStep last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertEquals("failed", last.getStatus(), "没名单就没法踢，判 failed 不无限重试");
        assertNull(last.getRefId());
    }

    // ===== 普通动作不受影响 =====

    @Test
    void advance_normalAction_stillGoesSending_notDelegated() {
        ScriptTask t = task();
        when(taskMapper.selectById(TASK)).thenReturn(t);
        when(stepMapper.selectList(any())).thenReturn(List.of(row("post_message")));
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def("post_message", "{}")));
        svc.advance(TASK, LocalDateTime.now());
        ArgumentCaptor<ScriptTaskStep> cap = ArgumentCaptor.forClass(ScriptTaskStep.class);
        verify(stepMapper, org.mockito.Mockito.atLeastOnce()).updateById(cap.capture());
        ScriptTaskStep last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertEquals("sending", last.getStatus(), "普通动作照旧置 sending 派发");
        assertNull(last.getRefType());
        org.mockito.Mockito.verifyNoInteractions(joinService, kickService);
    }

    // ===== JSON 极简解析 =====

    @Test
    void jsonStringAndListParseParams() {
        assertEquals("CODE1", ScriptSchedulerService.jsonString("{\"inviteCode\":\"CODE1\"}", "inviteCode"));
        assertNull(ScriptSchedulerService.jsonString("{}", "inviteCode"));
        assertEquals(List.of("a@c.us", "b@c.us"),
            ScriptSchedulerService.jsonList("{\"participantIds\":[\"a@c.us\",\"b@c.us\"]}", "participantIds"));
        assertTrue(ScriptSchedulerService.jsonList("{}", "participantIds").isEmpty());
    }
}
