package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
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
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B23 客户跟进记录 · 数据层（租户隔离）。
 *
 * <p>三件事：跟进记录 CRUD、标签变更流水（只读查询 + 写入）、批量打/撤标签（批量操作条）。
 *
 * <p>流水的写入点在两处：单个客户改标签走 {@code CustomerService.setLabels}（删前取快照比对），
 * 批量打/撤标签走 {@link #batchLabel}——两处都落，因为 {@code customer_label} 是撤标即删行的关联表，
 * 事后无从回溯。流水只增不改不删。
 */
@Service
public class CustomerFollowUpService {

    private static final Set<String> TYPES = Set.of("note", "call", "email", "meeting", "other");

    private final CustomerFollowUpMapper followUpMapper;
    private final CustomerLabelChangeMapper changeMapper;
    private final CustomerMapper customerMapper;
    private final LabelMapper labelMapper;
    private final CustomerLabelMapper customerLabelMapper;

    public CustomerFollowUpService(CustomerFollowUpMapper followUpMapper,
                                   CustomerLabelChangeMapper changeMapper,
                                   CustomerMapper customerMapper,
                                   LabelMapper labelMapper,
                                   CustomerLabelMapper customerLabelMapper) {
        this.followUpMapper = followUpMapper;
        this.changeMapper = changeMapper;
        this.customerMapper = customerMapper;
        this.labelMapper = labelMapper;
        this.customerLabelMapper = customerLabelMapper;
    }

    // ---------- 跟进记录 ----------

    /** 新增跟进记录。content 必填；客户必须属本租户；type 落库归一。 */
    @Transactional
    public CustomerFollowUp create(Long tenantId, Long customerId, String type, String content,
                                   LocalDateTime remindAt, String createdBy) {
        if (content == null || content.isBlank()) {
            throw new BizException(40000, "跟进内容不能为空");
        }
        requireCustomerOwned(tenantId, customerId);
        CustomerFollowUp f = new CustomerFollowUp();
        f.setTenantId(tenantId);
        f.setCustomerId(customerId);
        f.setType(normalizeType(type));
        f.setContent(content.trim());
        f.setRemindAt(remindAt);
        f.setCreatedBy(createdBy == null || createdBy.isBlank() ? null : createdBy.trim());
        followUpMapper.insert(f);
        return f;
    }

    /** 某客户的跟进记录（按时间倒序；customerId 为空 = 本租户全部）。 */
    public List<CustomerFollowUp> list(Long tenantId, Long customerId) {
        LambdaQueryWrapper<CustomerFollowUp> w = new LambdaQueryWrapper<CustomerFollowUp>()
            .eq(CustomerFollowUp::getTenantId, tenantId);
        if (customerId != null) {
            w.eq(CustomerFollowUp::getCustomerId, customerId);
        }
        return followUpMapper.selectList(w.orderByDesc(CustomerFollowUp::getId));
    }

    public CustomerFollowUp get(Long tenantId, Long id) {
        CustomerFollowUp f = followUpMapper.selectById(id);
        if (f == null || !tenantId.equals(f.getTenantId())) {
            throw new BizException(40404, "跟进记录不存在: " + id);
        }
        return f;
    }

    /** 改：仅更新非 null 字段（type/content/remindAt）。 */
    @Transactional
    public CustomerFollowUp update(Long tenantId, Long id, String type, String content,
                                   LocalDateTime remindAt) {
        CustomerFollowUp f = get(tenantId, id);
        if (type != null) f.setType(normalizeType(type));
        if (content != null) {
            if (content.isBlank()) throw new BizException(40000, "跟进内容不能为空");
            f.setContent(content.trim());
        }
        if (remindAt != null) f.setRemindAt(remindAt);
        followUpMapper.updateById(f);
        return f;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id); // 归属校验，非本租户抛 404
        followUpMapper.deleteById(id);
    }

    // ---------- 标签变更流水 ----------

    /** 某客户的标签变更流水（倒序；customerId 为空 = 本租户全部）。 */
    public List<CustomerLabelChange> listChanges(Long tenantId, Long customerId) {
        LambdaQueryWrapper<CustomerLabelChange> w = new LambdaQueryWrapper<CustomerLabelChange>()
            .eq(CustomerLabelChange::getTenantId, tenantId);
        if (customerId != null) {
            w.eq(CustomerLabelChange::getCustomerId, customerId);
        }
        return changeMapper.selectList(w.orderByDesc(CustomerLabelChange::getId));
    }

    /** 落一条流水（只增）。action 归一为 add/remove。 */
    @Transactional
    public void recordChange(Long tenantId, Long customerId, Long labelId, String action,
                             String operator) {
        CustomerLabelChange c = new CustomerLabelChange();
        c.setTenantId(tenantId);
        c.setCustomerId(customerId);
        c.setLabelId(labelId);
        c.setAction("remove".equalsIgnoreCase(action) ? "remove" : "add");
        c.setOperator(operator == null || operator.isBlank() ? null : operator.trim());
        changeMapper.insert(c);
    }

    // ---------- 批量打 / 撤标签（批量操作条） ----------

    /**
     * 批量打/撤标签：对每个「客户 × 标签」组合做存在性判断，缺则加、有则撤，并逐条落流水。
     * 幂等——已挂的再打、没挂的再撤都不重复计数也不重复落流水。
     * 客户与标签都做归属校验，任一越权整批回滚（@Transactional）。
     *
     * @return 实际发生变更的条数
     */
    @Transactional
    public int batchLabel(Long tenantId, List<Long> customerIds, List<Long> labelIds, String action) {
        if (customerIds == null || customerIds.isEmpty()) {
            throw new BizException(40000, "请先选择客户");
        }
        if (labelIds == null || labelIds.isEmpty()) {
            throw new BizException(40000, "请先选择标签");
        }
        String act = normalizeAction(action);
        Set<Long> ownedLabels = labelMapper.selectList(new LambdaQueryWrapper<Label>()
                .eq(Label::getTenantId, tenantId)
                .in(Label::getId, labelIds))
            .stream().map(Label::getId).collect(Collectors.toSet());
        for (Long labelId : labelIds) {
            if (!ownedLabels.contains(labelId)) {
                throw new BizException(40400, "标签不存在: " + labelId);
            }
        }
        int n = 0;
        for (Long customerId : customerIds) {
            requireCustomerOwned(tenantId, customerId);
            for (Long labelId : labelIds) {
                boolean exists = customerLabelMapper.exists(new LambdaQueryWrapper<CustomerLabel>()
                    .eq(CustomerLabel::getCustomerId, customerId)
                    .eq(CustomerLabel::getLabelId, labelId));
                if ("add".equals(act)) {
                    if (exists) continue;
                    CustomerLabel row = new CustomerLabel();
                    row.setTenantId(tenantId);
                    row.setCustomerId(customerId);
                    row.setLabelId(labelId);
                    customerLabelMapper.insert(row);
                    recordChange(tenantId, customerId, labelId, "add", null);
                    n++;
                } else {
                    if (!exists) continue;
                    customerLabelMapper.delete(new LambdaQueryWrapper<CustomerLabel>()
                        .eq(CustomerLabel::getCustomerId, customerId)
                        .eq(CustomerLabel::getLabelId, labelId));
                    recordChange(tenantId, customerId, labelId, "remove", null);
                    n++;
                }
            }
        }
        return n;
    }

    /** 客户归属校验：非本租户（或不存在）抛 404。 */
    public void requireCustomerOwned(Long tenantId, Long customerId) {
        Customer c = customerMapper.selectById(customerId);
        if (c == null || !tenantId.equals(c.getTenantId())) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
    }

    private static String normalizeType(String type) {
        if (type == null) return "note";
        String t = type.trim().toLowerCase();
        return TYPES.contains(t) ? t : "note";
    }

    private static String normalizeAction(String action) {
        if (action == null) throw new BizException(40000, "action 只能是 add/remove");
        String a = action.trim().toLowerCase();
        if (!"add".equals(a) && !"remove".equals(a)) {
            throw new BizException(40000, "action 只能是 add/remove");
        }
        return a;
    }
}
