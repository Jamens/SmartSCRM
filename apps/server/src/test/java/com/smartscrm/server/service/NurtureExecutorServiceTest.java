package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.NurturePlan;
import com.smartscrm.server.entity.NurtureRun;
import com.smartscrm.server.mapper.NurturePlanMapper;
import com.smartscrm.server.mapper.NurtureRunMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B9 P10-2 执行链单测：到点建 slot / 幂等 / 人工门 / 回报。 */
class NurtureExecutorServiceTest {

    private static final Long TENANT = 1L, PLAN = 5L, RUN = 9L;

    private NurtureRunMapper runMapper;
    private NurturePlanMapper planMapper;
    private PlatformAccountMapper accountMapper;
    private NurtureExecutorService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { NurtureRun.class, NurturePlan.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        runMapper = mock(NurtureRunMapper.class);
        planMapper = mock(NurturePlanMapper.class);
        accountMapper = mock(PlatformAccountMapper.class);
        svc = new NurtureExecutorService(runMapper, planMapper, accountMapper);
    }

    private static NurturePlan plan(String status) {
        NurturePlan p = new NurturePlan();
        p.setId(PLAN);
        p.setTenantId(TENANT);
        p.setStatus(status);
        p.setAccountIds("[1,2,3]");
        p.setAtPoints("[\"00:00\"]"); // 已到点（任何时刻都过）
        p.setSpeakingRounds(1);
        p.setSeed(42L);
        return p;
    }

    private static NurtureRun run(String status) {
        NurtureRun r = new NurtureRun();
        r.setId(RUN);
        r.setTenantId(TENANT);
        r.setStatus(status);
        return r;
    }

    // ===== 到点建 slot =====

    @Test
    void scheduleDue_createsSlotPerAccount() {
        when(planMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan("confirmed"))));
        when(runMapper.selectCount(any())).thenReturn(0L); // 幂等检查：都还没建
        when(runMapper.selectList(any())).thenReturn(new ArrayList<>()); // allSlotsDone

        int made = svc.scheduleDue(LocalDateTime.now());

        assertEquals(3, made, "3 个账号 → 3 条待发");
        ArgumentCaptor<NurtureRun> cap = ArgumentCaptor.forClass(NurtureRun.class);
        verify(runMapper, org.mockito.Mockito.times(3)).insert(cap.capture());
        assertTrue(cap.getAllValues().stream().allMatch(r -> "pending".equals(r.getStatus())));
    }

    @Test
    void scheduleDue_usesReproducibleOrder() {
        when(planMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan("confirmed"))));
        when(runMapper.selectCount(any())).thenReturn(0L);
        when(runMapper.selectList(any())).thenReturn(new ArrayList<>());
        svc.scheduleDue(LocalDateTime.now());
        ArgumentCaptor<NurtureRun> cap = ArgumentCaptor.forClass(NurtureRun.class);
        verify(runMapper, org.mockito.Mockito.times(3)).insert(cap.capture());
        List<Long> order = new ArrayList<>();
        for (NurtureRun r : cap.getAllValues()) order.add(r.getAccountId());
        // 同 seed 必得同顺序
        assertEquals(order, NurtureExecutorService.speakingOrder(List.of(1L, 2L, 3L), 42L));
    }

    // ===== 幂等 =====

    @Test
    void scheduleDue_idempotent_skipsExistingSlot() {
        when(planMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan("confirmed"))));
        when(runMapper.selectCount(any())).thenReturn(1L); // 每个 slot 都已存在
        when(runMapper.selectList(any())).thenReturn(new ArrayList<>());
        int made = svc.scheduleDue(LocalDateTime.now());
        assertEquals(0, made, "已存在的 slot 不重复建（防重复发言）");
        verify(runMapper, never()).insert(any(NurtureRun.class));
    }

    @Test
    void scheduleDue_doneToday_skips() {
        NurturePlan p = plan("running");
        p.setLastRunDate(java.time.LocalDate.now());
        when(planMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(p)));
        // allSlotsDone=true（无 pending/sending）
        when(runMapper.selectCount(any())).thenReturn(0L);
        when(runMapper.selectList(any())).thenReturn(new ArrayList<>());
        assertEquals(0, svc.scheduleDue(LocalDateTime.now()), "今天全跑完不再建");
    }

    // ===== 人工门 =====

    @Test
    void scheduleDue_unconfirmedPlanIsRejected() {
        when(planMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan("pending"))));
        // listActive 只查 confirmed/running，这里直接验证 requireConfirmed 拦 pending
        assertThrows(BizException.class, () -> NurturePlanService.requireConfirmed(plan("pending")));
    }

    // ===== 领取与回报 =====

    @Test
    void claimPending_marksSending() {
        NurtureRun r = run("pending");
        when(runMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(r)));
        List<NurtureRun> got = svc.claimPending(TENANT, 10);
        assertEquals(1, got.size());
        assertEquals("sending", r.getStatus(), "领取即占位，防重复派发");
    }

    @Test
    void reportResult_successAndFailure() {
        NurtureRun s = run("sending");
        when(runMapper.selectById(RUN)).thenReturn(s);
        svc.reportResult(TENANT, RUN, true, "KEY1", null);
        assertEquals("success", s.getStatus());
        assertEquals("KEY1", s.getMsgKey());

        NurtureRun f = run("sending");
        when(runMapper.selectById(RUN)).thenReturn(f);
        svc.reportResult(TENANT, RUN, false, null, "boom");
        assertEquals("failed", f.getStatus());
        assertEquals("boom", f.getErrorDetail());
    }

    @Test
    void reportResult_duplicateIgnored() {
        NurtureRun s = run("success"); // 已终态
        when(runMapper.selectById(RUN)).thenReturn(s);
        svc.reportResult(TENANT, RUN, false, null, "late");
        assertEquals("success", s.getStatus(), "重复回报不改已终态");
    }
}
