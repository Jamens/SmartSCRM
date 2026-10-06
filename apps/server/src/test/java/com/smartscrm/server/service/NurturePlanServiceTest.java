package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.NurturePlanMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** B9 P10-1 单测：账号稳定排序（装箱可复现前提）/ 人工门 / 校验。 */
class NurturePlanServiceTest {

    private static final Long TENANT = 1L, PLAN = 8L;

    private NurturePlanMapper mapper;
    private PlatformAccountMapper accountMapper;
    private NurturePlanService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { NurturePlan.class, PlatformAccount.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        mapper = mock(NurturePlanMapper.class);
        accountMapper = mock(PlatformAccountMapper.class);
        svc = new NurturePlanService(mapper, accountMapper);
    }

    private static PlatformAccount acc(long id, int platform) {
        PlatformAccount a = new PlatformAccount();
        a.setId(id);
        a.setPlatformType(platform);
        return a;
    }

    private static NurturePlan plan(String status) {
        NurturePlan p = new NurturePlan();
        p.setId(PLAN);
        p.setTenantId(TENANT);
        p.setStatus(status);
        return p;
    }

    /** mock 返回**可变** list：service 会原地 sort，List.of() 不可变会抛 UnsupportedOperation。 */
    private void mockAccounts(PlatformAccount... accounts) {
        when(accountMapper.selectList(any())).thenReturn(new ArrayList<>(List.of(accounts)));
    }

    private NurturePlan create(List<Long> ids) {
        return svc.create(TENANT, "计划", "g@g.us", false, ids, 10, null, 42L, List.of("09:30"), 1, 60, 120, 20);
    }

    // ===== 可复现：账号按平台+id 稳定排序 =====

    @Test
    void create_sortsAccountsByPlatformThenId() {
        // 故意乱序返回、混合平台 —— 入库顺序应是平台码升序（0 在前）+ 同平台 id 升序
        mockAccounts(acc(3, 1), acc(1, 0), acc(2, 0), acc(4, 1));
        assertEquals("[1,2,3,4]", create(List.of(3L, 1L, 2L, 4L)).getAccountIds());
    }

    @Test
    void create_sameAccountSetDifferentInputOrder_sameStoredOrder() {
        mockAccounts(acc(3, 1), acc(1, 1), acc(2, 1));
        var a = create(List.of(3L, 1L, 2L));
        mockAccounts(acc(1, 1), acc(3, 1), acc(2, 1));
        var b = create(List.of(1L, 3L, 2L));
        assertEquals(a.getAccountIds(), b.getAccountIds(), "装箱可复现的前提在数据层");
    }

    @Test
    void create_platformCodeComparedNumericallyNotAsString() {
        // 平台码 2 与 10：按字符串比 "10" < "2" 会排错，必须按数值
        mockAccounts(acc(1, 2), acc(2, 10));
        assertEquals("[1,2]", create(List.of(1L, 2L)).getAccountIds());
    }

    // ===== 人工门 =====

    @Test
    void create_startsPending() {
        mockAccounts(acc(1, 1));
        assertEquals("pending", create(List.of(1L)).getStatus());
    }

    @Test
    void requireConfirmed_blocksUnconfirmed() {
        assertThrows(BizException.class, () -> NurturePlanService.requireConfirmed(plan("pending")));
        assertThrows(BizException.class, () -> NurturePlanService.requireConfirmed(plan("running")));
        assertThrows(BizException.class, () -> NurturePlanService.requireConfirmed(null));
        NurturePlanService.requireConfirmed(plan("confirmed"));
    }

    @Test
    void confirm_onlyFromPending() {
        when(mapper.selectById(PLAN)).thenReturn(plan("pending"));
        assertEquals("confirmed", svc.confirm(TENANT, PLAN).getStatus());
        when(mapper.selectById(PLAN)).thenReturn(plan("done"));
        assertThrows(BizException.class, () -> svc.confirm(TENANT, PLAN));
    }

    // ===== 校验 =====

    @Test
    void create_rejectsEmptyAccountsOrAtPoints() {
        mockAccounts(acc(1, 1));
        assertThrows(BizException.class, () -> svc.create(TENANT, "p", "g@g.us", false, List.of(),
            10, null, 1L, List.of("10:00"), 1, 60, 120, 20));
        assertThrows(BizException.class, () -> svc.create(TENANT, "p", "g@g.us", false, List.of(1L),
            10, null, 1L, List.of(), 1, 60, 120, 20));
    }

    @Test
    void create_requiresGroupKeyUnlessCreateGroup() {
        mockAccounts(acc(1, 1));
        assertThrows(BizException.class, () -> svc.create(TENANT, "p", null, false, List.of(1L),
            10, null, 1L, List.of("10:00"), 1, 60, 120, 20), "不开建群开关就必须给群 chatKey");
        var p = svc.create(TENANT, "p", null, true, List.of(1L), 10, null, 1L, List.of("10:00"), 1, 60, 120, 20);
        assertEquals(1, p.getCreateGroup());
    }

    @Test
    void create_rejectsAccountsNotOwned() {
        mockAccounts(acc(1, 1)); // 只查到 1 个，却传了 2 个 → 有一个不属于本租户
        assertThrows(BizException.class, () -> create(List.of(1L, 2L)));
        verify(mapper, never()).insert(any(NurturePlan.class));
    }

    @Test
    void otherTenantPlan_isNotFound() {
        NurturePlan other = plan("confirmed");
        other.setTenantId(999L);
        when(mapper.selectById(PLAN)).thenReturn(other);
        assertThrows(BizException.class, () -> svc.confirm(TENANT, PLAN));
    }

    // ===== JSON 序列化 =====

    @Test
    void toJson_numbersUnquoted_stringsQuoted() {
        assertEquals("[1,2,3]", NurturePlanService.toJson(List.of(1, 2, 3)));
        assertEquals("[\"09:30\",\"20:00\"]", NurturePlanService.toJson(List.of("09:30", "20:00")));
        assertNotNull(NurturePlanService.toJson(null));
        assertTrue(NurturePlanService.toJson(null).equals("[]"));
    }
}
