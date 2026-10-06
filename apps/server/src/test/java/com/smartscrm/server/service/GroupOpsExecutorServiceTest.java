package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupJoinItem;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.entity.GroupKickItem;
import com.smartscrm.server.entity.GroupKickTask;
import com.smartscrm.server.mapper.GroupJoinItemMapper;
import com.smartscrm.server.mapper.GroupJoinTaskMapper;
import com.smartscrm.server.mapper.GroupKickItemMapper;
import com.smartscrm.server.mapper.GroupKickTaskMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B18/B19 P9-5 执行链单测：人工门在入口拦截 / skipped 不算失败 / 计数回填 / 随机间隔。 */
class GroupOpsExecutorServiceTest {

    private static final Long TENANT = 1L, TASK = 5L, ITEM = 9L;

    private GroupJoinTaskMapper joinTaskMapper;
    private GroupJoinItemMapper joinItemMapper;
    private GroupKickTaskMapper kickTaskMapper;
    private GroupKickItemMapper kickItemMapper;
    private GroupOpsExecutorService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { GroupJoinTask.class, GroupJoinItem.class,
            GroupKickTask.class, GroupKickItem.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        joinTaskMapper = mock(GroupJoinTaskMapper.class);
        joinItemMapper = mock(GroupJoinItemMapper.class);
        kickTaskMapper = mock(GroupKickTaskMapper.class);
        kickItemMapper = mock(GroupKickItemMapper.class);
        svc = new GroupOpsExecutorService(joinTaskMapper, joinItemMapper, kickTaskMapper, kickItemMapper);
    }

    private static GroupJoinTask joinTask(String status) {
        GroupJoinTask t = new GroupJoinTask();
        t.setId(TASK);
        t.setTenantId(TENANT);
        t.setStatus(status);
        return t;
    }

    private static GroupKickTask kickTask(String approval) {
        GroupKickTask t = new GroupKickTask();
        t.setId(TASK);
        t.setTenantId(TENANT);
        t.setApprovalStatus(approval);
        return t;
    }

    private static GroupJoinItem joinItem(String status) {
        GroupJoinItem i = new GroupJoinItem();
        i.setId(ITEM);
        i.setTenantId(TENANT);
        i.setTaskId(TASK);
        i.setStatus(status);
        return i;
    }

    private static GroupKickItem kickItem(String status) {
        GroupKickItem i = new GroupKickItem();
        i.setId(ITEM);
        i.setTenantId(TENANT);
        i.setTaskId(TASK);
        i.setStatus(status);
        return i;
    }

    // ===== 人工门在执行链入口（第二道） =====

    @Test
    void claimNextJoinItem_blocksUnconfirmedTask() {
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("pending"));
        assertThrows(BizException.class, () -> svc.claimNextJoinItem(TENANT, TASK),
            "未 confirmed 的任务在执行链入口必须被拒（不只 UI 挡）");
        verify(joinItemMapper, never()).updateById(any(GroupJoinItem.class));
    }

    @Test
    void claimNextKickItem_blocksUnapprovedTask() {
        when(kickTaskMapper.selectById(TASK)).thenReturn(kickTask("pending"));
        assertThrows(BizException.class, () -> svc.claimNextKickItem(TENANT, TASK));
        verify(kickItemMapper, never()).updateById(any(GroupKickItem.class));
    }

    @Test
    void claimNextJoinItem_confirmedClaimsAndMarksJoining() {
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("confirmed"));
        when(joinItemMapper.selectOne(any())).thenReturn(joinItem("pending"));
        var got = svc.claimNextJoinItem(TENANT, TASK);
        assertEquals(ITEM, got.getId());
        assertEquals("joining", got.getStatus(), "取走即占位 joining，防并发重复取");
    }

    @Test
    void claimNextJoinItem_returnsNull_whenNoPending() {
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("confirmed"));
        when(joinItemMapper.selectOne(any())).thenReturn(null);
        assertNull(svc.claimNextJoinItem(TENANT, TASK), "无待办返回 null（驱动据此收工）");
    }

    // ===== 结果回填 =====

    @Test
    void reportJoinResult_pendingApprovalCountsAsJoined() {
        GroupJoinItem item = joinItem("joining");
        when(joinItemMapper.selectById(ITEM)).thenReturn(item);
        when(joinItemMapper.selectList(any())).thenReturn(List.of(item));
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("running"));

        svc.reportJoinResult(TENANT, TASK, ITEM, true, "g1@g.us", true, null);

        assertEquals("joined", item.getStatus(), "已提交审核=成功，不能判失败（否则重复提交）");
        assertEquals("pending_approval", item.getMsgKey(), "留痕区分真进去/等审核");
    }

    @Test
    void reportJoinResult_duplicateReportIgnored() {
        GroupJoinItem item = joinItem("joined"); // 已终态
        when(joinItemMapper.selectById(ITEM)).thenReturn(item);
        svc.reportJoinResult(TENANT, TASK, ITEM, false, null, false, "late frame");
        assertEquals("joined", item.getStatus(), "重复回报不改已终态（别被覆盖成 failed）");
    }

    @Test
    void reportJoinResult_failureIsTerminal_noRetry() {
        GroupJoinItem item = joinItem("joining");
        when(joinItemMapper.selectById(ITEM)).thenReturn(item);
        when(joinItemMapper.selectList(any())).thenReturn(List.of(item));
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("running"));
        svc.reportJoinResult(TENANT, TASK, ITEM, false, null, false, "invite expired");
        assertEquals("failed", item.getStatus());
        assertEquals("invite expired", item.getErrorDetail());
    }

    @Test
    void reportKickResult_skippedIsNotFailure() {
        GroupKickItem item = kickItem("removing");
        when(kickItemMapper.selectById(ITEM)).thenReturn(item);
        when(kickItemMapper.selectList(any())).thenReturn(List.of(item));
        when(kickTaskMapper.selectById(TASK)).thenReturn(kickTask("approved"));
        svc.reportKickResult(TENANT, TASK, ITEM, "skipped", null);
        assertEquals("skipped", item.getStatus());
        assertEquals(0, item.getCanRemove(), "记录能力不允许（超管/自己）");
    }

    @Test
    void reportKickResult_removedAndFailedSplit() {
        GroupKickItem ok = kickItem("removing");
        ok.setId(1L);
        GroupKickItem bad = kickItem("removing");
        bad.setId(2L);
        when(kickItemMapper.selectById(1L)).thenReturn(ok);
        when(kickItemMapper.selectById(2L)).thenReturn(bad);
        when(kickItemMapper.selectList(any())).thenReturn(List.of(ok, bad));
        when(kickTaskMapper.selectById(TASK)).thenReturn(kickTask("approved"));
        svc.reportKickResult(TENANT, TASK, 1L, "removed", null);
        svc.reportKickResult(TENANT, TASK, 2L, "failed", "boom");
        assertEquals("removed", ok.getStatus());
        assertEquals(1, ok.getCanRemove());
        assertEquals("failed", bad.getStatus());
    }

    @Test
    void recount_marksTaskDoneWhenAllTerminal() {
        GroupJoinItem a = joinItem("joined");
        GroupJoinItem b = joinItem("failed");
        when(joinItemMapper.selectList(any())).thenReturn(List.of(a, b));
        GroupJoinTask t = joinTask("running");
        when(joinTaskMapper.selectById(TASK)).thenReturn(t);
        svc.recountJoin(TENANT, TASK);
        assertEquals("done", t.getStatus(), "全部终态 → done");
        assertEquals(1, t.getSucceeded());
        assertEquals(1, t.getFailed());
        assertEquals(2, t.getTotal());
    }

    @Test
    void recount_keepsRunningWhenSomeJoining() {
        GroupJoinItem a = joinItem("joined");
        GroupJoinItem b = joinItem("joining");
        when(joinItemMapper.selectList(any())).thenReturn(List.of(a, b));
        GroupJoinTask t = joinTask("running");
        when(joinTaskMapper.selectById(TASK)).thenReturn(t);
        svc.recountJoin(TENANT, TASK);
        assertEquals("running", t.getStatus(), "还有在途 → 保持 running");
    }

    // ===== 随机间隔 =====

    @Test
    void nextDelayMs_withinConfiguredRangeAndReproducible() {
        GroupJoinTask t = joinTask("confirmed");
        t.setIntervalMinSec(60);
        t.setIntervalMaxSec(120);
        t.setJitterPct(20);
        long a = svc.nextDelayMs(t, 0);
        long b = svc.nextDelayMs(t, 0);
        assertEquals(a, b, "同 taskId 同 doneCount → 同间隔（断点续跑节奏稳定）");
        assertTrue(a >= 48000 && a <= 144000, "±20% 抖动应在合理范围: " + a);
    }

    @Test
    void nextDelayMs_swapsWhenMinGreaterThanMax() {
        GroupJoinTask t = joinTask("confirmed");
        t.setIntervalMinSec(120);
        t.setIntervalMaxSec(60);
        t.setJitterPct(0);
        assertTrue(svc.nextDelayMs(t, 0) >= 60000 && svc.nextDelayMs(t, 0) <= 120000);
    }
}
