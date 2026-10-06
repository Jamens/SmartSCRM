package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
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
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B20 单测：总览聚合（含 B9 多账号）/ 删除先停任务 / 跨租户拒绝。 */
class AutomationServiceTest {

    private static final Long TENANT = 1L, ACCT = 7L;

    private PlatformAccountMapper accountMapper;
    private ScriptTaskMapper scriptTaskMapper;
    private NurturePlanMapper nurturePlanMapper;
    private GroupJoinTaskMapper joinTaskMapper;
    private GroupKickTaskMapper kickTaskMapper;
    private ScriptTaskService scriptTaskService;
    private NurturePlanService nurturePlanService;
    private GroupJoinService groupJoinService;
    private GroupKickService groupKickService;
    private AutomationService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { PlatformAccount.class, ScriptTask.class, NurturePlan.class,
            GroupJoinTask.class, GroupKickTask.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        accountMapper = mock(PlatformAccountMapper.class);
        scriptTaskMapper = mock(ScriptTaskMapper.class);
        nurturePlanMapper = mock(NurturePlanMapper.class);
        joinTaskMapper = mock(GroupJoinTaskMapper.class);
        kickTaskMapper = mock(GroupKickTaskMapper.class);
        scriptTaskService = mock(ScriptTaskService.class);
        nurturePlanService = mock(NurturePlanService.class);
        groupJoinService = mock(GroupJoinService.class);
        groupKickService = mock(GroupKickService.class);
        svc = new AutomationService(accountMapper, scriptTaskMapper, nurturePlanMapper, joinTaskMapper,
            kickTaskMapper, scriptTaskService, nurturePlanService, groupJoinService, groupKickService);
    }

    private static PlatformAccount acct(long id, int status) {
        PlatformAccount a = new PlatformAccount();
        a.setId(id);
        a.setTenantId(TENANT);
        a.setStatus(status);
        return a;
    }

    private static ScriptTask scriptTask(long id, long accountId, String status) {
        ScriptTask t = new ScriptTask();
        t.setId(id);
        t.setTenantId(TENANT);
        t.setAccountId(accountId);
        t.setStatus(status);
        return t;
    }

    private static NurturePlan plan(long id, String accountsJson, String status) {
        NurturePlan p = new NurturePlan();
        p.setId(id);
        p.setTenantId(TENANT);
        p.setAccountIds(accountsJson);
        p.setStatus(status);
        return p;
    }

    // ===== 总览聚合 =====

    @Test
    void overview_countsB9MultiAccountUnderEachAccount() {
        when(accountMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(acct(7, 1), acct(8, 0))));
        when(scriptTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(scriptTask(1, 7, "running"))));
        // B9 多账号：账号 7 和 8 都挂着这个计划
        when(nurturePlanMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan(2, "[7,8]", "running"))));
        when(joinTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(kickTaskMapper.selectList(any())).thenReturn(new ArrayList<>());

        var vo = svc.overview(TENANT);

        assertEquals(2, vo.accountsTotal());
        assertEquals(1, vo.accountsOnline());
        assertEquals(2, vo.tasksTotal(), "1 个 B8 + 1 个 B9");
        assertEquals(2, vo.tasksActive());
        // B9 挂在两个账号上——每账号 activeTasks 都应为 2（B8 在 7 上 + B9 在 7/8 上）
        assertEquals(2, vo.accounts().get(0).activeTasks(), "账号7: B8 + B9");
        assertEquals(1, vo.accounts().get(1).activeTasks(), "账号8: 只 B9（多账号展开）");
    }

    @Test
    void overview_byKindAndStatus() {
        when(accountMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(acct(7, 1))));
        when(scriptTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(
            scriptTask(1, 7, "running"), scriptTask(2, 7, "done"))));
        when(nurturePlanMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(joinTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(kickTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        var vo = svc.overview(TENANT);
        assertEquals(2L, vo.byKind().get("script"));
        assertEquals(1L, vo.byStatus().get("running"));
        assertEquals(1L, vo.byStatus().get("done"));
        assertEquals(1, vo.tasksActive(), "终态 done 不算在跑");
    }

    // ===== 删除先停任务 =====

    @Test
    void deleteAccounts_stopsRunningTasksBeforeDeleting() {
        when(accountMapper.selectById(ACCT)).thenReturn(acct(ACCT, 1));
        when(scriptTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(scriptTask(1, ACCT, "running"))));
        when(nurturePlanMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(plan(2, "[7]", "confirmed"))));
        when(joinTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(
            kickLikeJoin(3, "pending"))));
        when(kickTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(kickLikeKick(4, "running"))));

        int stopped = svc.deleteAccounts(TENANT, List.of(ACCT));

        assertEquals(4, stopped, "4 个在跑任务都先停");
        verify(scriptTaskService).cancel(TENANT, 1L);
        verify(nurturePlanService).cancel(TENANT, 2L);
        verify(groupJoinService).cancel(TENANT, 3L);
        verify(groupKickService).cancel(TENANT, 4L);
        verify(accountMapper).deleteById(ACCT);
    }

    @Test
    void deleteAccounts_doesNotStopTerminalTasks() {
        when(accountMapper.selectById(ACCT)).thenReturn(acct(ACCT, 1));
        when(scriptTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(scriptTask(1, ACCT, "done"))));
        when(nurturePlanMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(joinTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(kickTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        assertEquals(0, svc.deleteAccounts(TENANT, List.of(ACCT)), "终态任务无需停");
        verify(accountMapper).deleteById(ACCT);
    }

    @Test
    void deleteAccounts_otherTenant_isNotFound() {
        PlatformAccount other = acct(ACCT, 1);
        other.setTenantId(999L);
        when(accountMapper.selectById(ACCT)).thenReturn(other);
        assertThrows(BizException.class, () -> svc.deleteAccounts(TENANT, List.of(ACCT)));
    }

    @Test
    void deleteAccounts_emptyIds_rejected() {
        assertThrows(BizException.class, () -> svc.deleteAccounts(TENANT, List.of()));
    }

    // ===== 关闭：停账号 + 停任务，可恢复 =====

    @Test
    void closeAccounts_stopsAccountAndItsTasks() {
        when(accountMapper.selectById(ACCT)).thenReturn(acct(ACCT, 1));
        when(scriptTaskMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(scriptTask(1, ACCT, "running"))));
        when(nurturePlanMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(joinTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(kickTaskMapper.selectList(any())).thenReturn(new ArrayList<>());
        svc.closeAccounts(TENANT, List.of(ACCT));
        verify(scriptTaskService).cancel(TENANT, 1L);
        // 账号被置为离线（status=0），不删
        verify(accountMapper).update(any(), any());
    }

    // ===== B9 account_ids 解析 =====

    @Test
    void parseIds_handlesArrayAndScalar() {
        assertEquals(List.of(2L, 6L, 7L), AutomationService.parseIds("[2,6,7]"));
        assertEquals(List.of(3L), AutomationService.parseIds("[3]"));
        assertEquals(List.of(), AutomationService.parseIds(null));
        assertEquals(List.of(), AutomationService.parseIds("[]"));
    }

    private static GroupJoinTask kickLikeJoin(long id, String status) {
        GroupJoinTask t = new GroupJoinTask();
        t.setId(id);
        t.setTenantId(TENANT);
        t.setAccountId(ACCT);
        t.setStatus(status);
        return t;
    }

    private static GroupKickTask kickLikeKick(long id, String status) {
        GroupKickTask t = new GroupKickTask();
        t.setId(id);
        t.setTenantId(TENANT);
        t.setAccountId(ACCT);
        t.setStatus(status);
        return t;
    }
}
