package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiCategory;
import com.smartscrm.server.mapper.AiCategoryMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** B28 AI 分类（租户隔离，纯字典）。name 租户内唯一。 */
@Service
public class AiCategoryService {

    private final AiCategoryMapper mapper;

    public AiCategoryService(AiCategoryMapper mapper) {
        this.mapper = mapper;
    }

    public List<AiCategory> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<AiCategory>()
            .eq(AiCategory::getTenantId, tenantId)
            .orderByAsc(AiCategory::getSort).orderByAsc(AiCategory::getId));
    }

    @Transactional
    public AiCategory create(Long tenantId, String name, Integer sort) {
        String n = requireName(name);
        if (exists(tenantId, n, null)) {
            throw new BizException(40000, "分类名已存在: " + n);
        }
        AiCategory c = new AiCategory();
        c.setTenantId(tenantId);
        c.setName(n);
        c.setSort(sort == null ? 0 : sort);
        mapper.insert(c);
        return c;
    }

    @Transactional
    public AiCategory update(Long tenantId, Long id, String name, Integer sort) {
        AiCategory existing = get(tenantId, id);
        if (name != null && !name.isBlank()) {
            String n = name.trim();
            if (exists(tenantId, n, id)) {
                throw new BizException(40000, "分类名已存在: " + n);
            }
            existing.setName(n);
        }
        if (sort != null) existing.setSort(sort);
        mapper.updateById(existing);
        return existing;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        mapper.deleteById(get(tenantId, id).getId());
    }

    private AiCategory get(Long tenantId, Long id) {
        AiCategory c = mapper.selectById(id);
        if (c == null || !tenantId.equals(c.getTenantId())) {
            throw new BizException(40404, "分类不存在: " + id);
        }
        return c;
    }

    private boolean exists(Long tenantId, String name, Long excludeId) {
        return mapper.selectCount(new LambdaQueryWrapper<AiCategory>()
            .eq(AiCategory::getTenantId, tenantId)
            .eq(AiCategory::getName, name)
            .ne(excludeId != null, AiCategory::getId, excludeId)) > 0;
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "name 不能为空");
        }
        return name.trim();
    }
}
