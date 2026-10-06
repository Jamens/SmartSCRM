package com.smartscrm.server.service.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AdminUserMapper;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.service.admin.AdminUserService.UserRow;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

class AdminUserServiceTest {

    private AdminUserMapper mapper;
    private PasswordEncoder encoder;
    private TenantMapper tenantMapper;
    private AdminUserService service;

    @BeforeEach
    void setUp() {
        mapper = mock(AdminUserMapper.class);
        encoder = mock(PasswordEncoder.class);
        tenantMapper = mock(TenantMapper.class);
        when(encoder.encode(anyString())).thenReturn("hashed");
        service = new AdminUserService(mapper, encoder, tenantMapper);
    }

    private AppUser user(long id, Long tenantId, String username, int status) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setTenantId(tenantId);
        u.setUsername(username);
        u.setPasswordHash("hash");
        u.setRole("agent");
        u.setStatus(status);
        return u;
    }

    private Tenant tenant(long id, Integer seatLimit) {
        Tenant t = new Tenant();
        t.setId(id);
        t.setSeatLimit(seatLimit);
        return t;
    }

    @Test
    void page_mapsUserRows() {
        when(mapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<AppUser>(1, 20) {{
                    setRecords(List.of(user(1L, 10L, "alice", 1)));
                    setTotal(1);
                }});

        PageResult<UserRow> res = service.page(10L, null, 1, 20);

        assertEquals(1, res.total());
        assertEquals("alice", res.records().get(0).username());
        assertEquals(10L, res.records().get(0).tenantId());
    }

    @Test
    void page_spansTenantsWhenTenantIdNull() {
        // Platform admins list every account; the wrapper must carry no tenant filter.
        when(mapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<AppUser>(1, 20) {{
                    setRecords(List.of(user(1L, 10L, "alice", 1), user(2L, 11L, "bob", 1)));
                    setTotal(2);
                }});

        PageResult<UserRow> res = service.page(null, null, 1, 20);

        assertEquals(2, res.total());
    }

    @Test
    void assignRoles_replacesRoleSet() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));

        service.assignRoles(1L, Set.of(2L, 3L));

        verify(mapper).deleteRolesByUserId(1L);
        verify(mapper).insertRoles(eq(1L), any());
    }

    @Test
    void assignRoles_acceptsEmptySet() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));

        service.assignRoles(1L, Set.of());

        verify(mapper).deleteRolesByUserId(1L);
        verify(mapper, never()).insertRoles(anyLong(), any());
    }

    @Test
    void assignRoles_throwsWhenUserMissing() {
        when(mapper.selectById(99L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.assignRoles(99L, Set.of(1L)));
    }

    @Test
    void setStatus_updatesUser() {
        AppUser u = user(1L, 10L, "alice", 1);
        when(mapper.selectById(1L)).thenReturn(u);
        when(mapper.updateById(any(AppUser.class))).thenReturn(1);

        service.setStatus(1L, 0);

        assertEquals(0, u.getStatus());
        verify(mapper).updateById(u);
    }

    @Test
    void setStatus_rejectsUnknownValue() {
        AppUser u = user(1L, 10L, "alice", 1);
        when(mapper.selectById(1L)).thenReturn(u);

        BizException ex = assertThrows(BizException.class, () -> service.setStatus(1L, 9));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(AppUser.class));
    }

    @Test
    void roleIds_returnsGrantedRoles() {
        when(mapper.roleIdsByUserId(1L)).thenReturn(Set.of(2L, 3L));

        assertEquals(Set.of(2L, 3L), service.roleIds(1L));
    }

    @Test
    void create_hashesPasswordAndDefaultsTenant() {
        when(mapper.insert((AppUser) any())).thenAnswer(inv -> {
            ((AppUser) inv.getArgument(0)).setId(42L);
            return 1;
        });

        UserRow row = service.create("bob", "secret123", "Bob", null, null, null, 10L, null);

        assertEquals(42L, row.id());
        assertEquals(10L, row.tenantId());
        assertEquals("agent", row.role());
        assertEquals(1, row.status());
        assertNull(row.portLimit());
        verify(encoder).encode("secret123");
    }

    @Test
    void create_usesOperatorTenantWhenTenantIdOmitted() {
        service.create("carol", "secret123", null, null, "admin", 0, 5L, null);

        ArgumentCaptor<AppUser> cap = ArgumentCaptor.forClass(AppUser.class);
        verify(mapper).insert(cap.capture());
        AppUser inserted = cap.getValue();
        assertEquals(5L, inserted.getTenantId());
        assertEquals("admin", inserted.getRole());
        assertEquals(0, inserted.getStatus());
    }

    @Test
    void create_rejectsWhenNoTenantResolvable() {
        assertThrows(BizException.class, () -> service.create("dave", "secret123", null, null, null, null, null, null));
    }

    @Test
    void create_rejectsShortPassword() {
        assertThrows(BizException.class, () -> service.create("eve", "123", null, 1L, null, null, 1L, null));
    }

    @Test
    void create_acceptsPortLimitWithinTenantQuota() {
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, 100));
        when(mapper.insert((AppUser) any())).thenAnswer(inv -> {
            ((AppUser) inv.getArgument(0)).setId(43L);
            return 1;
        });

        UserRow row = service.create("finn", "secret123", null, 10L, null, 1, 10L, 50);

        assertEquals(50, row.portLimit());
    }

    @Test
    void create_rejectsPortLimitAboveTenantQuota() {
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, 100));

        BizException ex = assertThrows(BizException.class,
                () -> service.create("grace", "secret123", null, 10L, null, 1, 10L, 150));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).insert((AppUser) any());
    }

    @Test
    void create_acceptsUnlimitedTenantWithAnyPortLimit() {
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, null));
        when(mapper.insert((AppUser) any())).thenAnswer(inv -> {
            ((AppUser) inv.getArgument(0)).setId(44L);
            return 1;
        });

        UserRow row = service.create("heidi", "secret123", null, 10L, null, 1, 10L, 999);
        assertEquals(999, row.portLimit());
    }

    @Test
    void setPortLimit_updatesWithinQuota() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, 100));
        when(mapper.updateById(any(AppUser.class))).thenReturn(1);

        service.setPortLimit(1L, 30);

        ArgumentCaptor<AppUser> cap = ArgumentCaptor.forClass(AppUser.class);
        verify(mapper).updateById(cap.capture());
        assertEquals(30, cap.getValue().getPortLimit());
    }

    @Test
    void setPortLimit_rejectsAboveQuota() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, 100));

        BizException ex = assertThrows(BizException.class, () -> service.setPortLimit(1L, 200));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(AppUser.class));
    }

    @Test
    void setPortLimit_acceptsNullAsUnlimited() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));
        when(tenantMapper.selectById(10L)).thenReturn(tenant(10L, 100));
        when(mapper.updateById(any(AppUser.class))).thenReturn(1);

        service.setPortLimit(1L, null);

        ArgumentCaptor<AppUser> cap = ArgumentCaptor.forClass(AppUser.class);
        verify(mapper).updateById(cap.capture());
        assertNull(cap.getValue().getPortLimit());
    }

    @Test
    void resetPassword_hashesNewPassword() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));
        when(encoder.encode("newpass1")).thenReturn("newhash");
        when(mapper.updateById(any(AppUser.class))).thenReturn(1);

        service.resetPassword(1L, "newpass1");

        ArgumentCaptor<AppUser> cap = ArgumentCaptor.forClass(AppUser.class);
        verify(mapper).updateById(cap.capture());
        assertEquals("newhash", cap.getValue().getPasswordHash());
        verify(encoder).encode("newpass1");
    }

    @Test
    void resetPassword_rejectsShortPassword() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));

        BizException ex = assertThrows(BizException.class, () -> service.resetPassword(1L, "123"));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(AppUser.class));
    }

    @Test
    void delete_removesMembershipsThenUser() {
        when(mapper.selectById(1L)).thenReturn(user(1L, 10L, "alice", 1));
        when(mapper.deleteById(1L)).thenReturn(1);

        service.delete(1L);

        verify(mapper).deleteRolesByUserId(1L);
        verify(mapper).deleteTeamsByUserId(1L);
        verify(mapper).deleteById(1L);
    }
}
