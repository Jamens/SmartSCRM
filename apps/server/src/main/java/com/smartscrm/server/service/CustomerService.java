package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.CustomerLabel;
import com.smartscrm.server.entity.Label;
import com.smartscrm.server.mapper.CustomerLabelMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.LabelMapper;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.web.dto.CustomerCreateRequest;
import com.smartscrm.server.web.dto.CustomerEditRequest;
import com.smartscrm.server.web.vo.CustomerVO;
import com.smartscrm.server.web.vo.LabelVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CustomerService {

    private final CustomerMapper customerMapper;
    private final LabelMapper labelMapper;
    private final CustomerLabelMapper customerLabelMapper;

    public CustomerService(CustomerMapper customerMapper, LabelMapper labelMapper,
                           CustomerLabelMapper customerLabelMapper) {
        this.customerMapper = customerMapper;
        this.labelMapper = labelMapper;
        this.customerLabelMapper = customerLabelMapper;
    }

    public PageResult<CustomerVO> page(Long tenantId, String keyword, Integer platformType,
                                       List<Long> labelIds, String country, long page, long pageSize) {
        LambdaQueryWrapper<Customer> wrapper = filterWrapper(tenantId, keyword, platformType, country, labelIds, true)
            .orderByDesc(Customer::getUpdatedAt)
            .orderByDesc(Customer::getId);
        Page<Customer> result = customerMapper.selectPage(new Page<>(page, pageSize), wrapper);
        List<Long> ids = result.getRecords().stream().map(Customer::getId).toList();
        Map<Long, List<LabelVO>> labelMap = labelsByCustomerIds(ids);
        List<CustomerVO> vos = result.getRecords().stream()
            .map(c -> CustomerVO.of(c, labelMap.getOrDefault(c.getId(), List.of())))
            .toList();
        return PageResult.of(vos, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public CustomerVO detail(Long tenantId, Long id) {
        Customer customer = requireOwned(tenantId, id);
        Map<Long, List<LabelVO>> labelMap = labelsByCustomerIds(List.of(id));
        return CustomerVO.of(customer, labelMap.getOrDefault(id, List.of()));
    }

    /**
     * open_id 是"这个人在这个平台上的 id"，聊天记录里的 chat_key 就是它。
     */
    @Transactional
    public CustomerVO create(Long tenantId, CustomerCreateRequest req) {
        String openId = req.openId().trim();
        if (req.platformType() == null || req.platformType() < 1 || req.platformType() > 7) {
            throw new BizException(40000, "platformType 只能是 1..7");
        }
        long dup = customerMapper.selectCount(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getPlatformType, req.platformType())
            .eq(Customer::getOpenId, openId));
        if (dup > 0) {
            throw new BizException(40901, "该平台下此客户已存在: " + openId);
        }
        Customer customer = new Customer();
        customer.setTenantId(tenantId);
        customer.setPlatformType(req.platformType());
        customer.setOpenId(openId);
        customer.setNickname(trimToNull(req.nickname()));
        customer.setPhone(trimToNull(req.phone()));
        customer.setEmail(trimToNull(req.email()));
        customer.setCountry(trimToNull(req.country()));
        customer.setRemark(trimToNull(req.remark()));
        customer.setSex(req.sex() == null ? 0 : requireSex(req.sex()));
        customer.setFirstSeenAt(LocalDateTime.now(MsgTimes.CHAT_ZONE));
        try {
            customerMapper.insert(customer);
        } catch (DuplicateKeyException raced) {
            // 上面的 dup 检查与 insert 之间有时间窗：两个并发请求（"建为客户"按钮被连点）会同时读到
            // dup==0，后落库的那个撞 uk_customer_tenant_platform_openid。不在这儿兜住，它会以
            // 50000 + MySQL 约束原文冒到前端——而 40901 才是前端能区分"已经存在"的那个码。
            throw new BizException(40901, "该平台下此客户已存在: " + openId);
        }
        return detail(tenantId, customer.getId());
    }

    private static String trimToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String t = raw.trim();
        return t.isEmpty() ? null : t;
    }

    /** sex 只有 0/1/2 三值（V3 的列注释），越界值能写进 TINYINT，然后在抽屉里渲染成"谁都没选中"。 */
    private static int requireSex(Integer sex) {
        if (sex == null || sex < 0 || sex > 2) {
            throw new BizException(40000, "sex 只能是 0..2");
        }
        return sex;
    }

    public CustomerVO update(Long tenantId, Long id, CustomerEditRequest req) {
        Customer customer = requireOwned(tenantId, id);
        customer.setNickname(req.nickname());
        if (req.sex() != null) {
            customer.setSex(requireSex(req.sex()));
        }
        customer.setCountry(req.country());
        customer.setEmail(req.email());
        customer.setRemark(req.remark());
        customerMapper.updateById(customer);
        // updateById skips null fields, so cleared optional columns must be written explicitly.
        customerMapper.update(null, new LambdaUpdateWrapper<Customer>()
            .eq(Customer::getId, id)
            .set(Customer::getCountry, customer.getCountry())
            .set(Customer::getEmail, customer.getEmail())
            .set(Customer::getRemark, customer.getRemark()));
        return detail(tenantId, id);
    }

    @Transactional
    public CustomerVO setLabels(Long tenantId, Long id, List<Long> labelIds) {
        requireOwned(tenantId, id);
        customerLabelMapper.delete(new LambdaQueryWrapper<CustomerLabel>()
            .eq(CustomerLabel::getCustomerId, id));
        List<Long> requested = normalize(labelIds);
        if (!requested.isEmpty()) {
            Set<Long> owned = labelMapper.selectList(new LambdaQueryWrapper<Label>()
                    .eq(Label::getTenantId, tenantId)
                    .in(Label::getId, requested))
                .stream().map(Label::getId).collect(Collectors.toSet());
            for (Long labelId : requested) {
                if (!owned.contains(labelId)) {
                    throw new BizException(40400, "标签不存在: " + labelId);
                }
                CustomerLabel row = new CustomerLabel();
                row.setTenantId(tenantId);
                row.setCustomerId(id);
                row.setLabelId(labelId);
                customerLabelMapper.insert(row);
            }
        }
        return detail(tenantId, id);
    }

    public void delete(Long tenantId, Long id) {
        requireOwned(tenantId, id);
        customerMapper.deleteById(id);
    }

    public long countMatching(Long tenantId, String keyword, Integer platformType, String country,
                              List<Long> labelIds, boolean matchAllLabels) {
        return customerMapper.selectCount(
            filterWrapper(tenantId, keyword, platformType, country, labelIds, matchAllLabels));
    }

    static LabelVO toVO(Label label, long count) {
        return new LabelVO(label.getId(), label.getGroupId(), label.getName(), label.getColor(),
            label.getSort(), count);
    }

    private LambdaQueryWrapper<Customer> filterWrapper(Long tenantId, String keyword, Integer platformType,
                                                       String country, List<Long> labelIds, boolean matchAllLabels) {
        LambdaQueryWrapper<Customer> wrapper = new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId);
        if (StringUtils.hasText(keyword)) {
            String kw = keyword.trim();
            wrapper.and(x -> x.like(Customer::getNickname, kw)
                .or().like(Customer::getPhone, kw)
                .or().like(Customer::getEmail, kw));
        }
        if (platformType != null) {
            wrapper.eq(Customer::getPlatformType, platformType);
        }
        if (StringUtils.hasText(country)) {
            wrapper.eq(Customer::getCountry, country);
        }
        List<Long> ids = normalize(labelIds);
        if (!ids.isEmpty()) {
            if (matchAllLabels) {
                for (Long labelId : ids) {
                    wrapper.inSql(Customer::getId,
                        "select customer_id from customer_label where label_id = " + labelId);
                }
            } else {
                String joined = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
                wrapper.inSql(Customer::getId,
                    "select customer_id from customer_label where label_id in (" + joined + ")");
            }
        }
        return wrapper;
    }

    private Map<Long, List<LabelVO>> labelsByCustomerIds(Collection<Long> customerIds) {
        if (customerIds.isEmpty()) {
            return Map.of();
        }
        List<CustomerLabel> links = customerLabelMapper.selectList(new LambdaQueryWrapper<CustomerLabel>()
            .in(CustomerLabel::getCustomerId, customerIds));
        if (links.isEmpty()) {
            return Map.of();
        }
        Set<Long> labelIds = links.stream().map(CustomerLabel::getLabelId).collect(Collectors.toSet());
        Map<Long, Long> counts = useCounts(labelIds);
        Map<Long, Label> labelById = labelMapper.selectBatchIds(labelIds).stream()
            .collect(Collectors.toMap(Label::getId, l -> l));
        Map<Long, List<LabelVO>> byCustomer = new HashMap<>();
        for (CustomerLabel link : links) {
            Label label = labelById.get(link.getLabelId());
            if (label == null) {
                continue;
            }
            byCustomer.computeIfAbsent(link.getCustomerId(), k -> new ArrayList<>())
                .add(toVO(label, counts.getOrDefault(label.getId(), 0L)));
        }
        return byCustomer;
    }

    private Map<Long, Long> useCounts(Collection<Long> labelIds) {
        if (labelIds.isEmpty()) {
            return Map.of();
        }
        List<CustomerLabel> rows = customerLabelMapper.selectList(new LambdaQueryWrapper<CustomerLabel>()
            .in(CustomerLabel::getLabelId, labelIds));
        Map<Long, Long> counts = new HashMap<>();
        for (CustomerLabel row : rows) {
            counts.merge(row.getLabelId(), 1L, Long::sum);
        }
        return counts;
    }

    private Customer requireOwned(Long tenantId, Long id) {
        Customer customer = customerMapper.selectById(id);
        if (customer == null || !Objects.equals(customer.getTenantId(), tenantId)) {
            throw new BizException(40404, "客户不存在");
        }
        return customer;
    }

    private List<Long> normalize(List<Long> labelIds) {
        if (labelIds == null) {
            return List.of();
        }
        return new ArrayList<>(new LinkedHashSet<>(labelIds.stream().filter(Objects::nonNull).toList()));
    }
}
