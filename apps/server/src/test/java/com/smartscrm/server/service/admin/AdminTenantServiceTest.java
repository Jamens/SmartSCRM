package com.smartscrm.server.service.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AdminTenantMapper;
import com.smartscrm.server.service.admin.AdminTenantService.TenantRow;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AdminTenantServiceTest {

    private AdminTenantMapper mapper;
    private AdminTenantService service;

    @BeforeEach
    void setUp() {
        mapper = mock(AdminTenantMapper.class);
        service = new AdminTenantService(mapper);
    }

    private Tenant tenant(long id, String code, String name, int status) {
        Tenant t = new Tenant();
        t.setId(id);
        t.setInviteCode(code);
        t.setName(name);
        t.setStatus(status);
        t.setCreatedAt(LocalDateTime.now());
        t.setUpdatedAt(LocalDateTime.now());
        return t;
    }

    @Test
    void page_returnsRowsWithoutTenantFilter() {
        // The whole point of the admin package: the tenant list spans every tenant,
        // so no eq(tenantId) may appear in the wrapper.
        when(mapper.selectPage(any(IPage.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<Tenant>(1, 20) {{
                    setRecords(List.of(tenant(1L, "A", "Tenant A", 1), tenant(2L, "B", "Tenant B", 0)));
                    setTotal(2);
                }});

        PageResult<TenantRow> res = service.page("Ten", 1, 1, 20);

        assertEquals(2, res.total());
        assertEquals(2, res.records().size());
        assertEquals("A", res.records().get(0).inviteCode());
        assertEquals("B", res.records().get(1).inviteCode());
    }

    @Test
    void page_mapsStatusIntoRow() {
        when(mapper.selectPage(any(IPage.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<Tenant>(1, 20) {{
                    setRecords(List.of(tenant(1L, "A", "Tenant A", 1)));
                    setTotal(1);
                }});

        PageResult<TenantRow> res = service.page(null, null, 1, 20);

        assertEquals(1, res.records().get(0).status());
        assertEquals(1L, res.records().get(0).id());
        assertEquals("Tenant A", res.records().get(0).name());
    }

    @Test
    void detail_returnsRow() {
        when(mapper.selectById(5L)).thenReturn(tenant(5L, "CODE", "Name", 1));

        TenantRow row = service.detail(5L);

        assertNotNull(row);
        assertEquals(5L, row.id());
        assertEquals("CODE", row.inviteCode());
    }

    @Test
    void detail_mapsSeatLimitIntoRow() {
        Tenant t = tenant(5L, "CODE", "Name", 1);
        t.setSeatLimit(12);
        when(mapper.selectById(5L)).thenReturn(t);

        TenantRow row = service.detail(5L);

        assertEquals(12, row.seatLimit());
    }

    @Test
    void setQuota_updatesSeatLimit() {
        Tenant t = tenant(7L, "G", "Tenant G", 1);
        when(mapper.selectById(7L)).thenReturn(t);
        when(mapper.updateById(any(Tenant.class))).thenReturn(1);

        TenantRow row = service.setQuota(7L, 25);

        assertEquals(25, row.seatLimit());
        verify(mapper).updateById(t);
    }

    @Test
    void setQuota_allowsUnlimitedViaNull() {
        Tenant t = tenant(7L, "G", "Tenant G", 1);
        when(mapper.selectById(7L)).thenReturn(t);
        when(mapper.updateById(any(Tenant.class))).thenReturn(1);

        TenantRow row = service.setQuota(7L, null);

        assertEquals(null, row.seatLimit());
        verify(mapper).updateById(t);
    }

    @Test
    void setQuota_rejectsNegative() {
        Tenant t = tenant(7L, "G", "Tenant G", 1);
        when(mapper.selectById(7L)).thenReturn(t);

        BizException ex = assertThrows(BizException.class, () -> service.setQuota(7L, -1));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(Tenant.class));
    }

    @Test
    void setQuota_rejectsOverCap() {
        Tenant t = tenant(7L, "G", "Tenant G", 1);
        when(mapper.selectById(7L)).thenReturn(t);

        BizException ex = assertThrows(BizException.class, () -> service.setQuota(7L, 100001));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(Tenant.class));
    }

    @Test
    void delete_removesTenantWhenEmpty() {
        when(mapper.selectById(9L)).thenReturn(tenant(9L, "H", "Tenant H", 1));
        when(mapper.countUsers(9L)).thenReturn(0L);
        when(mapper.countPlatformAccounts(9L)).thenReturn(0L);
        when(mapper.deleteById(9L)).thenReturn(1);

        service.delete(9L);

        verify(mapper).deleteById(9L);
    }

    @Test
    void delete_refusesWhenUsersPresent() {
        when(mapper.selectById(9L)).thenReturn(tenant(9L, "H", "Tenant H", 1));
        when(mapper.countUsers(9L)).thenReturn(3L);
        when(mapper.countPlatformAccounts(9L)).thenReturn(0L);

        BizException ex = assertThrows(BizException.class, () -> service.delete(9L));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).deleteById(anyLong());
    }

    @Test
    void detail_throws_whenMissing() {
        when(mapper.selectById(99L)).thenReturn(null);

        BizException ex = assertThrows(BizException.class, () -> service.detail(99L));
        assertEquals(40400, ex.getCode());
    }

    @Test
    void setStatus_updatesTenant() {
        Tenant t = tenant(3L, "C", "Tenant C", 1);
        when(mapper.selectById(3L)).thenReturn(t);
        when(mapper.updateById(any(Tenant.class))).thenReturn(1);

        service.setStatus(3L, 0);

        assertEquals(0, t.getStatus());
        verify(mapper).updateById(t);
    }

    @Test
    void setStatus_rejectsUnknownStatus() {
        Tenant t = tenant(3L, "C", "Tenant C", 1);
        when(mapper.selectById(3L)).thenReturn(t);

        BizException ex = assertThrows(BizException.class, () -> service.setStatus(3L, 7));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(Tenant.class));
    }

    @Test
    void setStatus_throws_whenMissing() {
        when(mapper.selectById(88L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.setStatus(88L, 1));
    }

    @Test
    void rename_updatesName() {
        Tenant t = tenant(4L, "D", "Old", 1);
        when(mapper.selectById(4L)).thenReturn(t);
        when(mapper.updateById(any(Tenant.class))).thenReturn(1);

        service.rename(4L, "New");

        assertEquals("New", t.getName());
        verify(mapper).updateById(t);
    }

    @Test
    void rename_rejectsBlank() {
        Tenant t = tenant(4L, "D", "Old", 1);
        when(mapper.selectById(4L)).thenReturn(t);

        BizException ex = assertThrows(BizException.class, () -> service.rename(4L, "  "));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(Tenant.class));
    }

    @Test
    void counts_returnsAggregates() {
        when(mapper.countUsers(anyLong())).thenReturn(4L);
        when(mapper.countPlatformAccounts(anyLong())).thenReturn(2L);

        AdminTenantService.TenantCounts c = service.counts(1L);

        assertEquals(4L, c.users());
        assertEquals(2L, c.platformAccounts());
    }

    @Test
    void counts_zeroWhenNoRows() {
        when(mapper.countUsers(anyLong())).thenReturn(0L);
        when(mapper.countPlatformAccounts(anyLong())).thenReturn(0L);

        AdminTenantService.TenantCounts c = service.counts(2L);

        assertEquals(0L, c.users());
        assertTrue(c.platformAccounts() == 0L);
    }
}
