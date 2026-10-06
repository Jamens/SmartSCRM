package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CloudAccount;
import com.smartscrm.server.entity.CloudAccountGroup;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.CloudAccountGroupMapper;
import com.smartscrm.server.mapper.CloudAccountMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * B21 单测：归属校验（跨租户 404）/ 缺名 400 / platform·status 归一 / 列表隔离 /
 * 批量转移（目标分组与批次归属）/ 同步到本地（落成 platform_account 且回写 syncedAt）/ 分组删前解挂。
 */
class CloudAccountServiceTest {

    private static final Long TENANT = 1L, OTHER = 2L;

    private CloudAccountMapper accountMapper;
    private CloudAccountGroupMapper groupMapper;
    private CloudAccountGroupService groupService;
    private PlatformAccountService platformAccountService;
    private CloudAccountService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(assistant, CloudAccount.class);
        TableInfoHelper.initTableInfo(assistant, CloudAccountGroup.class);
        TableInfoHelper.initTableInfo(assistant, PlatformAccount.class);
        accountMapper = mock(CloudAccountMapper.class);
        groupMapper = mock(CloudAccountGroupMapper.class);
        platformAccountService = mock(PlatformAccountService.class);
        // 分组服务用真实实现（只 mock 它的两个 mapper），顺带覆盖分组自身的租户隔离与删前解挂。
        groupService = new CloudAccountGroupService(groupMapper, accountMapper);
        svc = new CloudAccountService(accountMapper, groupService, platformAccountService);
    }

    private static CloudAccount account(Long id, Long tenantId) {
        CloudAccount a = new CloudAccount();
        a.setId(id);
        a.setTenantId(tenantId);
        a.setName("acc-" + id);
        a.setPlatform("whatsapp");
        a.setStatus("offline");
        return a;
    }

    private static CloudAccountGroup group(Long id, Long tenantId) {
        CloudAccountGroup g = new CloudAccountGroup();
        g.setId(id);
        g.setTenantId(tenantId);
        g.setName("grp-" + id);
        return g;
    }

    @Test
    void createRejectsBlankName() {
        assertThrows(BizException.class,
            () -> svc.create(TENANT, null, "  ", null, null, null, null));
    }

    @Test
    void createNormalizesPlatformAndStatus() {
        CloudAccount created = svc.create(TENANT, null, "ACC", "861380000", "Telegram", "ONLINE", "r");
        verify(accountMapper).insert(any(CloudAccount.class));
        assertEquals("telegram", created.getPlatform());   // 大小写归一
        assertEquals("online", created.getStatus());
        assertEquals(TENANT, created.getTenantId());
        assertNull(created.getGroupId());
        // 未知值归一默认
        CloudAccount d2 = svc.create(TENANT, null, "ACC2", null, "bogus", "weird", null);
        assertEquals("whatsapp", d2.getPlatform());
        assertEquals("offline", d2.getStatus());
    }

    @Test
    void createRejectsForeignGroup() {
        when(groupMapper.selectById(5L)).thenReturn(group(5L, OTHER));
        BizException ex = assertThrows(BizException.class,
            () -> svc.create(TENANT, 5L, "ACC", null, null, null, null));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void listIsTenantScoped() {
        when(accountMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(account(10L, TENANT)));
        assertEquals(1, svc.list(TENANT).size());
        verify(accountMapper).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void getEnforcesTenantIsolation() {
        when(accountMapper.selectById(10L)).thenReturn(account(10L, TENANT));
        assertEquals(10L, svc.get(TENANT, 10L).getId());
        when(accountMapper.selectById(11L)).thenReturn(account(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.get(TENANT, 11L));
        assertEquals(40404, ex.getCode());
        when(accountMapper.selectById(99L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.get(TENANT, 99L));
    }

    @Test
    void updateAppliesPartialAndNormalizes() {
        CloudAccount existing = account(10L, TENANT);
        when(accountMapper.selectById(10L)).thenReturn(existing);
        CloudAccount up = svc.update(TENANT, 10L, null, null, null, "LINE", "Banned", null);
        assertEquals("line", up.getPlatform());
        assertEquals("banned", up.getStatus());
        verify(accountMapper).updateById(any(CloudAccount.class));
        assertThrows(BizException.class,
            () -> svc.update(TENANT, 10L, null, "  ", null, null, null, null));
    }

    @Test
    void deleteEnforcesTenantIsolation() {
        when(accountMapper.selectById(10L)).thenReturn(account(10L, TENANT));
        svc.delete(TENANT, 10L);
        verify(accountMapper).deleteById(10L);
        when(accountMapper.selectById(11L)).thenReturn(account(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.delete(TENANT, 11L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void transferMovesBatchAndValidatesOwnership() {
        when(groupMapper.selectById(5L)).thenReturn(group(5L, TENANT));
        when(accountMapper.selectById(10L)).thenReturn(account(10L, TENANT));
        when(accountMapper.selectById(11L)).thenReturn(account(11L, TENANT));
        int n = svc.transfer(TENANT, List.of(10L, 11L), 5L);
        assertEquals(2, n, "两个本租户云号都应转移");
        ArgumentCaptor<CloudAccount> cap = ArgumentCaptor.forClass(CloudAccount.class);
        verify(accountMapper, org.mockito.Mockito.times(2)).updateById(cap.capture());
        assertTrue(cap.getAllValues().stream().allMatch(a -> a.getGroupId() == 5L), "都应挂到目标分组");

        // 批次里混入他租户的号 → 整批失败（归属校验）
        when(accountMapper.selectById(12L)).thenReturn(account(12L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.transfer(TENANT, List.of(10L, 12L), 5L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void transferRejectsEmptyAndForeignGroup() {
        assertThrows(BizException.class, () -> svc.transfer(TENANT, List.of(), null));
        when(groupMapper.selectById(6L)).thenReturn(group(6L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.transfer(TENANT, List.of(10L), 6L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void syncCreatesLocalAccountAndWritesBack() {
        CloudAccount existing = account(10L, TENANT);
        existing.setStatus("online");
        when(accountMapper.selectById(10L)).thenReturn(existing);
        // 本地账号服务：原样回填一个带 id 的实体（真实实现会 insert 后 selectById）。
        when(platformAccountService.create(any(), any())).thenAnswer(inv -> {
            PlatformAccount body = inv.getArgument(1);
            body.setId(777L);
            return body;
        });

        CloudAccount synced = svc.sync(TENANT, 10L);
        assertNotNull(synced.getSyncedAt(), "同步时间应写回");
        assertEquals(777L, synced.getSyncedAccountId(), "本地账号 id 应回写");
        verify(accountMapper).updateById(any(CloudAccount.class));

        ArgumentCaptor<PlatformAccount> cap = ArgumentCaptor.forClass(PlatformAccount.class);
        verify(platformAccountService).create(any(), cap.capture());
        PlatformAccount local = cap.getValue();
        assertEquals(1, local.getPlatformType(), "whatsapp → platform_type 1");
        assertEquals("acc-10", local.getName());
        assertEquals(1, local.getStatus(), "online 云号同步为本地在线(1)");
        assertTrue(local.getRemark().contains("#10"), "备注应带云号 id 便于追溯");

        // 跨租户同步被拦
        when(accountMapper.selectById(11L)).thenReturn(account(11L, OTHER));
        assertThrows(BizException.class, () -> svc.sync(TENANT, 11L));
    }

    @Test
    void platformTypeFollowsSharedEnum() {
        assertEquals(1, CloudAccountService.platformTypeOf("whatsapp"));
        assertEquals(2, CloudAccountService.platformTypeOf("line"));
        assertEquals(4, CloudAccountService.platformTypeOf("telegram"));
        assertEquals(1, CloudAccountService.platformTypeOf("bogus")); // 未知兜底 WhatsApp
    }

    @Test
    void groupCrudEnforcesTenantIsolation() {
        assertThrows(BizException.class, () -> groupService.create(TENANT, "  ", null));
        when(groupMapper.selectById(5L)).thenReturn(group(5L, TENANT));
        assertEquals(5L, groupService.get(TENANT, 5L).getId());
        when(groupMapper.selectById(6L)).thenReturn(group(6L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> groupService.get(TENANT, 6L));
        assertEquals(40404, ex.getCode());
        when(groupMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(group(5L, TENANT)));
        assertEquals(1, groupService.list(TENANT).size());
    }

    @Test
    void groupDeleteUnassignsMemberAccounts() {
        when(groupMapper.selectById(5L)).thenReturn(group(5L, TENANT));
        groupService.delete(TENANT, 5L);
        verify(groupMapper).deleteById(5L);

        // 挂靠的云号应被置为未分组，避免悬挂 group_id
        @SuppressWarnings("unchecked")
        ArgumentCaptor<LambdaUpdateWrapper<CloudAccount>> cap =
            ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(accountMapper).update(org.mockito.ArgumentMatchers.<CloudAccount>isNull(), cap.capture());
        // 注：纯单测里 MP 渲染的列名为 groupid（未走全局 map-underscore 配置），故两种写法都接受；
        // 真正的断言是「分组列被改写且绑定值为 NULL」，而不是列名的字面形态。
        String sqlSet = String.valueOf(cap.getValue().getSqlSet()).toLowerCase();
        assertTrue(sqlSet.contains("groupid") || sqlSet.contains("group_id"), "应改写分组列: " + sqlSet);
        var pairs = cap.getValue().getParamNameValuePairs();
        boolean nullAssigned = pairs.entrySet().stream()
            .anyMatch(e -> e.getKey().matches("MPGENVAL\\d+") && e.getValue() == null);
        assertTrue(nullAssigned, "分组列应置为 NULL: " + pairs);
    }
}
