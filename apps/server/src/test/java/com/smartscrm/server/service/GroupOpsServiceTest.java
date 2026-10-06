package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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

/** B18/B19 P9-4 单测：人工门（核心）+ 能力门 + 导入去重/上限。 */
class GroupOpsServiceTest {

    private static final Long TENANT = 1L, TASK = 5L;

    private GroupJoinTaskMapper joinTaskMapper;
    private GroupJoinItemMapper joinItemMapper;
    private GroupKickTaskMapper kickTaskMapper;
    private GroupKickItemMapper kickItemMapper;
    private GroupJoinService joinService;
    private GroupKickService kickService;

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
        joinService = new GroupJoinService(joinTaskMapper, joinItemMapper);
        kickService = new GroupKickService(kickTaskMapper, kickItemMapper);
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

    // ===== B18 人工门 =====

    @Test
    void joinCreate_startsPending_notConfirmed() {
        var t = joinService.create(TENANT, 7L, "任务", "abc\ndef", 60, 120, 20);
        assertEquals("pending", t.getStatus(), "建完必须是 pending（人工门未过）");
        assertEquals(2, t.getTotal());
        verify(joinItemMapper, times(2)).insert(any(GroupJoinItem.class));
    }

    @Test
    void joinRequireConfirmed_blocksUnconfirmed() {
        assertThrows(BizException.class, () -> GroupJoinService.requireConfirmed(joinTask("pending")));
        assertThrows(BizException.class, () -> GroupJoinService.requireConfirmed(joinTask("running")));
        assertThrows(BizException.class, () -> GroupJoinService.requireConfirmed(null));
        GroupJoinService.requireConfirmed(joinTask("confirmed")); // 不抛 = 通过
    }

    @Test
    void joinConfirm_onlyFromPending() {
        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("pending"));
        assertEquals("confirmed", joinService.confirm(TENANT, TASK).getStatus());

        when(joinTaskMapper.selectById(TASK)).thenReturn(joinTask("done"));
        assertThrows(BizException.class, () -> joinService.confirm(TENANT, TASK), "非 pending 不可确认");
    }

    @Test
    void joinCreate_dedupesCodes_andRejectsEmpty() {
        var t = joinService.create(TENANT, 7L, "任务", "abc\nabc\ndef,abc", null, null, null);
        assertEquals(2, t.getTotal(), "重复邀请码应去重");

        assertThrows(BizException.class, () -> joinService.create(TENANT, 7L, "任务", "  ", null, null, null));
        assertThrows(BizException.class, () -> joinService.create(TENANT, null, "任务", "abc", null, null, null));
    }

    // ===== B19 人工门 + 能力门 =====

    @Test
    void kickCreate_startsApprovalPending() {
        var t = kickService.create(TENANT, 7L, "g1@g.us", "任务", null, List.of("a@c.us", "b@c.us"));
        assertEquals("pending", t.getApprovalStatus(), "名单建完必须待审阅");
        assertEquals("pending", t.getStatus());
        verify(kickItemMapper, times(2)).insert(any(GroupKickItem.class));
    }

    @Test
    void kickRequireApproved_blocksPendingAndRejected() {
        assertThrows(BizException.class, () -> GroupKickService.requireApproved(kickTask("pending")));
        assertThrows(BizException.class, () -> GroupKickService.requireApproved(kickTask("rejected")));
        assertThrows(BizException.class, () -> GroupKickService.requireApproved(null));
        GroupKickService.requireApproved(kickTask("approved")); // 不抛 = 通过
    }

    @Test
    void kickApproveReject_onlyFromPending() {
        when(kickTaskMapper.selectById(TASK)).thenReturn(kickTask("pending"));
        assertEquals("approved", kickService.approve(TENANT, TASK).getApprovalStatus());
        when(kickTaskMapper.selectById(TASK)).thenReturn(kickTask("rejected"));
        assertThrows(BizException.class, () -> kickService.approve(TENANT, TASK));
        assertThrows(BizException.class, () -> kickService.reject(TENANT, TASK));
    }

    @Test
    void kickShouldKick_onlyWhenCanRemoveExplicitlyTrue() {
        assertTrue(GroupKickService.shouldKick(Boolean.TRUE));
        assertFalse(GroupKickService.shouldKick(Boolean.FALSE), "不可踢→不踢（防踢超管）");
        assertFalse(GroupKickService.shouldKick(null), "未校验 ≠ 允许");
    }

    @Test
    void kickCreate_rejectsEmptyGroupOrList() {
        assertThrows(BizException.class, () -> kickService.create(TENANT, 7L, " ", "n", null, List.of("a")));
        assertThrows(BizException.class, () -> kickService.create(TENANT, 7L, "g", "n", null, List.of()));
    }

    @Test
    void otherTenantTask_isNotFound() {
        GroupKickTask other = kickTask("approved");
        other.setTenantId(999L);
        when(kickTaskMapper.selectById(TASK)).thenReturn(other);
        assertThrows(BizException.class, () -> kickService.approve(TENANT, TASK), "跨租户访问应 404");
        verify(kickTaskMapper, never()).updateById(any(GroupKickTask.class));
    }
}
