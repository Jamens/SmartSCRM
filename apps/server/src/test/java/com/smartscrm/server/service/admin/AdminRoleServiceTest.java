package com.smartscrm.server.service.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.SysMenu;
import com.smartscrm.server.entity.SysRole;
import com.smartscrm.server.mapper.AdminRoleMapper;
import com.smartscrm.server.service.admin.AdminRoleService.RoleRow;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AdminRoleServiceTest {

    private AdminRoleMapper mapper;
    private AdminRoleService service;

    @BeforeEach
    void setUp() {
        mapper = mock(AdminRoleMapper.class);
        service = new AdminRoleService(mapper);
    }

    private SysRole role(long id, String code, String name, int scope, int builtin, Long tenantId) {
        SysRole r = new SysRole();
        r.setId(id);
        r.setCode(code);
        r.setName(name);
        r.setScope(scope);
        r.setBuiltin(builtin);
        r.setTenantId(tenantId);
        r.setStatus(1);
        return r;
    }

    @Test
    void page_mapsRoleRows() {
        when(mapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<SysRole>(1, 20) {{
                    setRecords(List.of(role(1L, "super_admin", "超级管理员", 1, 1, null)));
                    setTotal(1);
                }});

        PageResult<RoleRow> res = service.page(1, 1L, 1, 20);

        assertEquals(1, res.total());
        assertEquals("super_admin", res.records().get(0).code());
        assertEquals(1, res.records().get(0).scope());
        assertEquals(1, res.records().get(0).builtin());
    }

    @Test
    void create_rejectsDuplicateCodeInSameScope() {
        when(mapper.existsByScopeAndCode(1, "ops")).thenReturn(1L);

        BizException ex = assertThrows(BizException.class,
                () -> service.create(1, null, "ops", "运营", null));
        assertEquals(40002, ex.getCode());
        verify(mapper, never()).insert(any(SysRole.class));
    }

    @Test
    void create_persistsRole() {
        when(mapper.existsByScopeAndCode(2, "team_lead")).thenReturn(0L);
        when(mapper.insert(any(SysRole.class))).thenReturn(1);

        RoleRow row = service.create(2, 10L, "team_lead", "组长", null);

        assertEquals("team_lead", row.code());
        assertEquals(2, row.scope());
        assertEquals(10L, row.tenantId());
        verify(mapper).insert(any(SysRole.class));
    }

    @Test
    void create_rejectsBlankCode() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create(1, null, "  ", "x", null));
        assertEquals(40001, ex.getCode());
    }

    @Test
    void delete_refusesBuiltinRole() {
        when(mapper.selectById(1L)).thenReturn(role(1L, "super_admin", "超级管理员", 1, 1, null));

        BizException ex = assertThrows(BizException.class, () -> service.delete(1L));
        assertEquals(40003, ex.getCode());
        verify(mapper, never()).deleteById(anyLong());
    }

    @Test
    void delete_removesCustomRole() {
        when(mapper.selectById(5L)).thenReturn(role(5L, "custom", "自定义", 2, 0, 10L));

        service.delete(5L);

        verify(mapper).deleteById(5L);
    }

    @Test
    void delete_throwsWhenMissing() {
        when(mapper.selectById(77L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.delete(77L));
    }

    @Test
    void grantMenus_replacesGrantSet() {
        when(mapper.selectById(3L)).thenReturn(role(3L, "ops", "运营", 1, 0, null));
        when(mapper.menuIdsByCodes(any())).thenReturn(List.of(1L, 2L, 3L));
        when(mapper.countMenusByCodes(any())).thenReturn(3L);

        service.grantMenus(3L, Set.of("tenant:list", "access", "role"));

        verify(mapper).deleteMenusByRoleId(3L);
        verify(mapper).insertMenus(eq(3L), any());
    }

    @Test
    void grantMenus_rejectsUnknownCodes() {
        when(mapper.selectById(3L)).thenReturn(role(3L, "ops", "运营", 1, 0, null));
        when(mapper.countMenusByCodes(any())).thenReturn(2L);

        BizException ex = assertThrows(BizException.class,
                () -> service.grantMenus(3L, Set.of("tenant:list", "access", "not:a:real:code")));
        assertEquals(40004, ex.getCode());
        verify(mapper, never()).deleteMenusByRoleId(anyLong());
    }

    @Test
    void grantMenus_acceptsEmptySet() {
        when(mapper.selectById(3L)).thenReturn(role(3L, "ops", "运营", 1, 0, null));
        when(mapper.countMenusByCodes(any())).thenReturn(0L);
        when(mapper.menuIdsByCodes(any())).thenReturn(List.of());

        service.grantMenus(3L, Set.of());

        verify(mapper).deleteMenusByRoleId(3L);
        verify(mapper, never()).insertMenus(anyLong(), any());
    }

    @Test
    void grantMenus_throwsWhenRoleMissing() {
        when(mapper.selectById(66L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.grantMenus(66L, Set.of("access")));
    }
}
