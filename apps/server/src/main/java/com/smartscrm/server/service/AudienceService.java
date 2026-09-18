package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.CustomerAudience;
import com.smartscrm.server.mapper.CustomerAudienceMapper;
import com.smartscrm.server.web.dto.AudienceRequest;
import com.smartscrm.server.web.vo.AudienceVO;
import com.smartscrm.server.web.vo.CustomerVO;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AudienceService {

    private final CustomerAudienceMapper mapper;
    private final CustomerService customerService;

    public AudienceService(CustomerAudienceMapper mapper, CustomerService customerService) {
        this.mapper = mapper;
        this.customerService = customerService;
    }

    public List<AudienceVO> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<CustomerAudience>()
                .eq(CustomerAudience::getTenantId, tenantId)
                .orderByDesc(CustomerAudience::getId))
            .stream()
            .map(a -> toVO(tenantId, a))
            .toList();
    }

    public AudienceVO detail(Long tenantId, Long id) {
        return toVO(tenantId, requireOwned(tenantId, id));
    }

    public PageResult<CustomerVO> customers(Long tenantId, Long id, long page, long pageSize) {
        CustomerAudience audience = requireOwned(tenantId, id);
        return customerService.page(tenantId, audience.getKeyword(), audience.getPlatformType(),
            parseTagIds(audience.getTagIds()), null, page, pageSize);
    }

    public AudienceVO create(Long tenantId, AudienceRequest req) {
        if (existsName(tenantId, req.name(), null)) {
            throw new BizException(40901, "人群包名称已存在");
        }
        CustomerAudience audience = new CustomerAudience();
        audience.setTenantId(tenantId);
        apply(audience, req);
        mapper.insert(audience);
        return toVO(tenantId, mapper.selectById(audience.getId()));
    }

    public AudienceVO update(Long tenantId, Long id, AudienceRequest req) {
        CustomerAudience audience = requireOwned(tenantId, id);
        if (existsName(tenantId, req.name(), id)) {
            throw new BizException(40901, "人群包名称已存在");
        }
        apply(audience, req);
        mapper.updateById(audience);
        return toVO(tenantId, mapper.selectById(id));
    }

    public void delete(Long tenantId, Long id) {
        requireOwned(tenantId, id);
        mapper.deleteById(id);
    }

    private void apply(CustomerAudience audience, AudienceRequest req) {
        audience.setName(req.name().trim());
        audience.setPlatformType(req.platformType());
        audience.setKeyword(StringUtils.hasText(req.keyword()) ? req.keyword().trim() : null);
        List<Long> tagIds = req.tagIds() == null ? List.of()
            : req.tagIds().stream().filter(Objects::nonNull).distinct().toList();
        audience.setTagIds(tagIds.isEmpty() ? null : join(tagIds));
    }

    private AudienceVO toVO(Long tenantId, CustomerAudience audience) {
        List<Long> tagIds = parseTagIds(audience.getTagIds());
        long count = customerService.countMatching(tenantId, audience.getKeyword(), audience.getPlatformType(),
            null, tagIds, true);
        return AudienceVO.of(audience, tagIds, count);
    }

    private CustomerAudience requireOwned(Long tenantId, Long id) {
        CustomerAudience audience = mapper.selectById(id);
        if (audience == null || !Objects.equals(audience.getTenantId(), tenantId)) {
            throw new BizException(40404, "人群包不存在");
        }
        return audience;
    }

    private boolean existsName(Long tenantId, String name, Long excludeId) {
        return mapper.exists(new LambdaQueryWrapper<CustomerAudience>()
            .eq(CustomerAudience::getTenantId, tenantId)
            .eq(CustomerAudience::getName, name.trim())
            .ne(excludeId != null, CustomerAudience::getId, excludeId));
    }

    private static String join(List<Long> ids) {
        return ids.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse(null);
    }

    private static List<Long> parseTagIds(String raw) {
        if (!StringUtils.hasText(raw)) {
            return List.of();
        }
        return Arrays.stream(raw.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .map(Long::valueOf)
            .toList();
    }
}
