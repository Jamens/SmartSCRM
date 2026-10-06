package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.CustomerFollowUp;
import com.smartscrm.server.entity.CustomerLabel;
import com.smartscrm.server.entity.CustomerLabelChange;
import com.smartscrm.server.entity.Label;
import com.smartscrm.server.mapper.CustomerFollowUpMapper;
import com.smartscrm.server.mapper.CustomerLabelChangeMapper;
import com.smartscrm.server.mapper.CustomerLabelMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.LabelMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * B23 单测：跟进记录（缺内容 400 / type 归一 / 客户归属 / 租户隔离 / 部分更新）+
 * 标签变更流水（add/remove 各落一条）+ 批量打/撤标签（幂等 / 归属校验 / 变更计数）。
 */
class CustomerFollowUpServiceTest {

    private static final Long TENANT = 1L, OTHER = 2L;
    private static final Long CID = 10L, LID = 20L;

    private CustomerFollowUpMapper followUpMapper;
    private CustomerLabelChangeMapper changeMapper;
    private CustomerMapper customerMapper;
    private LabelMapper labelMapper;
    private CustomerLabelMapper customerLabelMapper;
    private CustomerFollowUpService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant a = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(a, CustomerFollowUp.class);
        TableInfoHelper.initTableInfo(a, CustomerLabelChange.class);
        TableInfoHelper.initTableInfo(a, Customer.class);
        TableInfoHelper.initTableInfo(a, Label.class);
        TableInfoHelper.initTableInfo(a, CustomerLabel.class);
        followUpMapper = mock(CustomerFollowUpMapper.class);
        changeMapper = mock(CustomerLabelChangeMapper.class);
        customerMapper = mock(CustomerMapper.class);
        labelMapper = mock(LabelMapper.class);
        customerLabelMapper = mock(CustomerLabelMapper.class);
        svc = new CustomerFollowUpService(followUpMapper, changeMapper, customerMapper,
            labelMapper, customerLabelMapper);
        when(customerMapper.selectById(CID)).thenReturn(customer(CID, TENANT));
        when(labelMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(label(LID, TENANT)));
    }

    private static Customer customer(Long id, Long tenantId) {
        Customer c = new Customer();
        c.setId(id);
        c.setTenantId(tenantId);
        return c;
    }

    private static Label label(Long id, Long tenantId) {
        Label l = new Label();
        l.setId(id);
        l.setTenantId(tenantId);
        return l;
    }

    private static CustomerFollowUp followUp(Long id, Long tenantId) {
        CustomerFollowUp f = new CustomerFollowUp();
        f.setId(id);
        f.setTenantId(tenantId);
        f.setCustomerId(CID);
        f.setType("note");
        f.setContent("跟进内容");
        return f;
    }

    @Test
    void createValidatesContentAndCustomer() {
        assertThrows(BizException.class, () -> svc.create(TENANT, CID, null, "  ", null, null));
        // 他租户客户 → 404
        when(customerMapper.selectById(99L)).thenReturn(customer(99L, OTHER));
        BizException ex = assertThrows(BizException.class,
            () -> svc.create(TENANT, 99L, null, "x", null, null));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void createNormalizesTypeAndKeepsRemindAt() {
        LocalDateTime remind = LocalDateTime.of(2026, 11, 1, 9, 0);
        CustomerFollowUp f = svc.create(TENANT, CID, "CALL", " 电话沟通 ", remind, " 7 ");
        verify(followUpMapper).insert(any(CustomerFollowUp.class));
        assertEquals("call", f.getType());          // 大小写归一
        assertEquals("电话沟通", f.getContent());     // trim
        assertEquals(remind, f.getRemindAt());
        assertEquals("7", f.getCreatedBy());
        assertEquals(TENANT, f.getTenantId());
        // 未知 type 兜底 note
        assertEquals("note", svc.create(TENANT, CID, "bogus", "x", null, null).getType());
        assertNull(svc.create(TENANT, CID, null, "x", null, null).getRemindAt());
    }

    @Test
    void listAndGetEnforceTenantIsolation() {
        when(followUpMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(followUp(1L, TENANT)));
        assertEquals(1, svc.list(TENANT, CID).size());
        assertEquals(1, svc.list(TENANT, null).size());

        when(followUpMapper.selectById(1L)).thenReturn(followUp(1L, TENANT));
        assertEquals(1L, svc.get(TENANT, 1L).getId());
        when(followUpMapper.selectById(2L)).thenReturn(followUp(2L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.get(TENANT, 2L));
        assertEquals(40404, ex.getCode());
        when(followUpMapper.selectById(88L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.get(TENANT, 88L));
    }

    @Test
    void updateAppliesPartialAndRejectsBlankContent() {
        CustomerFollowUp existing = followUp(1L, TENANT);
        when(followUpMapper.selectById(1L)).thenReturn(existing);
        LocalDateTime remind = LocalDateTime.of(2026, 12, 1, 10, 0);
        CustomerFollowUp up = svc.update(TENANT, 1L, "MEETING", " 见面 ", remind);
        assertEquals("meeting", up.getType());
        assertEquals("见面", up.getContent());
        assertEquals(remind, up.getRemindAt());
        verify(followUpMapper).updateById(any(CustomerFollowUp.class));
        assertThrows(BizException.class, () -> svc.update(TENANT, 1L, null, "  ", null));
    }

    @Test
    void deleteEnforcesTenantIsolation() {
        when(followUpMapper.selectById(1L)).thenReturn(followUp(1L, TENANT));
        svc.delete(TENANT, 1L);
        verify(followUpMapper).deleteById(1L);
        when(followUpMapper.selectById(2L)).thenReturn(followUp(2L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.delete(TENANT, 2L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void recordChangeWritesAddAndRemove() {
        svc.recordChange(TENANT, CID, LID, "ADD", "7");
        ArgumentCaptor<CustomerLabelChange> cap = ArgumentCaptor.forClass(CustomerLabelChange.class);
        verify(changeMapper).insert(cap.capture());
        assertEquals("add", cap.getValue().getAction());
        assertEquals(LID, cap.getValue().getLabelId());
        assertEquals(CID, cap.getValue().getCustomerId());
        assertEquals("7", cap.getValue().getOperator());

        svc.recordChange(TENANT, CID, LID, "Remove", null);
        verify(changeMapper, times(2)).insert(any(CustomerLabelChange.class));
    }

    @Test
    void listChangesIsScopedByCustomer() {
        when(changeMapper.selectList(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(new CustomerLabelChange()));
        assertEquals(1, svc.listChanges(TENANT, CID).size());
        assertEquals(1, svc.listChanges(TENANT, null).size());
        verify(changeMapper, times(2)).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void batchLabelAddsAndRemovesIdempotently() {
        // 打标签：不存在 → insert + 落 add 流水，计数 1
        when(customerLabelMapper.exists(any(LambdaQueryWrapper.class))).thenReturn(false);
        int n = svc.batchLabel(TENANT, List.of(CID), List.of(LID), "add");
        assertEquals(1, n, "首次打标签应计数 1");
        verify(customerLabelMapper).insert(any(CustomerLabel.class));
        verify(changeMapper).insert(any(CustomerLabelChange.class));

        // 再打一次：已存在 → 幂等，不计数不落流水
        when(customerLabelMapper.exists(any(LambdaQueryWrapper.class))).thenReturn(true);
        assertEquals(0, svc.batchLabel(TENANT, List.of(CID), List.of(LID), "add"),
            "已挂的再打应幂等（0 条变更）");

        // 撤标签：存在 → delete + 落 remove 流水，计数 1
        int m = svc.batchLabel(TENANT, List.of(CID), List.of(LID), "remove");
        assertEquals(1, m, "撤标签应计数 1");
        verify(customerLabelMapper, times(1)).delete(any(LambdaQueryWrapper.class));
    }

    @Test
    void batchLabelValidatesSelectionAndOwnership() {
        assertThrows(BizException.class, () -> svc.batchLabel(TENANT, List.of(), List.of(LID), "add"));
        assertThrows(BizException.class, () -> svc.batchLabel(TENANT, List.of(CID), List.of(), "add"));
        assertThrows(BizException.class, () -> svc.batchLabel(TENANT, List.of(CID), List.of(LID), "bogus"));

        // 他租户客户 → 404（整批回滚）
        when(customerMapper.selectById(99L)).thenReturn(customer(99L, OTHER));
        BizException ex = assertThrows(BizException.class,
            () -> svc.batchLabel(TENANT, List.of(99L), List.of(LID), "add"));
        assertEquals(40404, ex.getCode());

        // 他租户（或不存在的）标签 → 40400。mapper 是 mock，租户过滤不会真的生效，
        // 故「查不到」就是他租户标签在真实库里的返回形态：空列表。
        when(labelMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
        BizException ex2 = assertThrows(BizException.class,
            () -> svc.batchLabel(TENANT, List.of(CID), List.of(LID), "add"));
        assertEquals(40400, ex2.getCode());
    }

    @Test
    void requireCustomerOwnedRejectsForeignCustomer() {
        svc.requireCustomerOwned(TENANT, CID);
        when(customerMapper.selectById(99L)).thenReturn(customer(99L, OTHER));
        assertThrows(BizException.class, () -> svc.requireCustomerOwned(TENANT, 99L));
        when(customerMapper.selectById(98L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.requireCustomerOwned(TENANT, 98L));
    }

    @Test
    void followUpKeepsRemindAtForPendingStats() {
        CustomerFollowUp f = svc.create(TENANT, CID, "note", "待跟进事项",
            LocalDateTime.of(2026, 11, 5, 9, 0), null);
        assertNotNull(f.getRemindAt(), "remindAt 为统计卡「待跟进」提供依据");
    }
}
