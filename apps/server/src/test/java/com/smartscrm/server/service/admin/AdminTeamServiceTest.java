package com.smartscrm.server.service.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
import com.smartscrm.server.entity.SysTeam;
import com.smartscrm.server.mapper.AdminTeamMapper;
import com.smartscrm.server.service.admin.AdminTeamService.TeamRow;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AdminTeamServiceTest {

    private AdminTeamMapper mapper;
    private AdminTeamService service;

    @BeforeEach
    void setUp() {
        mapper = mock(AdminTeamMapper.class);
        service = new AdminTeamService(mapper);
    }

    private SysTeam team(long id, Long tenantId, String name, long parentId, int scope) {
        SysTeam t = new SysTeam();
        t.setId(id);
        t.setTenantId(tenantId);
        t.setName(name);
        t.setParentId(parentId);
        t.setScope(scope);
        t.setStatus(1);
        return t;
    }

    @Test
    void page_mapsTeamRows() {
        when(mapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class)))
                .thenReturn(new Page<SysTeam>(1, 20) {{
                    setRecords(List.of(team(1L, 10L, "客服一组", 0L, 2)));
                    setTotal(1);
                }});

        PageResult<TeamRow> res = service.page(10L, 1, 20);

        assertEquals(1, res.total());
        assertEquals("客服一组", res.records().get(0).name());
        assertEquals(10L, res.records().get(0).tenantId());
    }

    @Test
    void create_requiresTenantForTenantScope() {
        BizException ex = assertThrows(BizException.class,
                () -> service.create(2, null, "x", 0L, 1, 0, null));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).insert(any(SysTeam.class));
    }

    @Test
    void create_persistsTeam() {
        when(mapper.insert(any(SysTeam.class))).thenReturn(1);

        TeamRow row = service.create(2, 10L, "客服二组", 0L, 1, 0, null);

        assertEquals("客服二组", row.name());
        assertEquals(2, row.scope());
        assertEquals(1, row.type());
        assertEquals(0, row.isPushTicket());
        assertNull(row.powers());
        verify(mapper).insert(any(SysTeam.class));
    }

    @Test
    void create_defaultsAndValidatesType() {
        when(mapper.insert(any(SysTeam.class))).thenReturn(1);
        // type=2 (DC) accepted
        TeamRow dc = service.create(2, 10L, "DC组", 0L, 2, 1, "ticket,report");
        assertEquals(2, dc.type());
        assertEquals(1, dc.isPushTicket());
        assertEquals("ticket,report", dc.powers());
        // invalid type -> rejected
        BizException ex = assertThrows(BizException.class,
                () -> service.create(2, 10L, "bad", 0L, 9, 0, null));
        assertEquals(40001, ex.getCode());
        // invalid push ticket -> rejected
        BizException ex2 = assertThrows(BizException.class,
                () -> service.create(2, 10L, "bad", 0L, 1, 9, null));
        assertEquals(40001, ex2.getCode());
        // blank powers -> null
        TeamRow blank = service.create(2, 10L, "空权", 0L, 1, 0, "   ");
        assertNull(blank.powers());
    }

    @Test
    void updateConfig_writesDepartmentAttributes() {
        SysTeam t = team(7L, 10L, "组", 0L, 2);
        when(mapper.selectById(7L)).thenReturn(t);
        when(mapper.updateById(any(SysTeam.class))).thenReturn(1);

        service.updateConfig(7L, 2, 1, "a,b");

        assertEquals(2, t.getType());
        assertEquals(1, t.getIsPushTicket());
        assertEquals("a,b", t.getPowers());
        verify(mapper).updateById(t);
    }

    @Test
    void updateConfig_rejectsBadType() {
        SysTeam t = team(8L, 10L, "组", 0L, 2);
        when(mapper.selectById(8L)).thenReturn(t);

        BizException ex = assertThrows(BizException.class,
                () -> service.updateConfig(8L, 5, 0, null));
        assertEquals(40001, ex.getCode());
        verify(mapper, never()).updateById(any(SysTeam.class));
    }

    @Test
    void create_rejectsBlankName() {
        assertThrows(BizException.class, () -> service.create(1, null, "  ", 0L, 1, 0, null));
    }

    @Test
    void delete_refusesTeamThatStillHasMembers() {
        when(mapper.selectById(3L)).thenReturn(team(3L, 10L, "有人的组", 0L, 2));
        when(mapper.countMembers(3L)).thenReturn(2L);

        BizException ex = assertThrows(BizException.class, () -> service.delete(3L));
        assertEquals(40005, ex.getCode());
        verify(mapper, never()).deleteById(anyLong());
    }

    @Test
    void delete_removesEmptyTeam() {
        when(mapper.selectById(4L)).thenReturn(team(4L, 10L, "空组", 0L, 2));
        when(mapper.countMembers(4L)).thenReturn(0L);

        service.delete(4L);

        verify(mapper).deleteMembersByTeamId(4L);
        verify(mapper).deleteById(4L);
    }

    @Test
    void delete_throwsWhenMissing() {
        when(mapper.selectById(55L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.delete(55L));
    }

    @Test
    void assignMembers_replacesMemberSet() {
        when(mapper.selectById(5L)).thenReturn(team(5L, 10L, "组", 0L, 2));

        service.assignMembers(5L, Set.of(1L, 2L));

        verify(mapper).deleteMembersByTeamId(5L);
        verify(mapper).insertMembers(eq(5L), any());
    }

    @Test
    void assignMembers_acceptsEmptySet() {
        when(mapper.selectById(5L)).thenReturn(team(5L, 10L, "组", 0L, 2));

        service.assignMembers(5L, Set.of());

        verify(mapper).deleteMembersByTeamId(5L);
        verify(mapper, never()).insertMembers(anyLong(), any());
    }

    @Test
    void assignMembers_throwsWhenTeamMissing() {
        when(mapper.selectById(66L)).thenReturn(null);

        assertThrows(BizException.class, () -> service.assignMembers(66L, Set.of(1L)));
    }

    @Test
    void rename_updatesName() {
        SysTeam t = team(6L, 10L, "旧名", 0L, 2);
        when(mapper.selectById(6L)).thenReturn(t);
        when(mapper.updateById(any(SysTeam.class))).thenReturn(1);

        service.rename(6L, "新名");

        assertEquals("新名", t.getName());
        verify(mapper).updateById(t);
    }
}
