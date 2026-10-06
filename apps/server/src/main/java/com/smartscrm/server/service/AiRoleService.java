package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiRole;
import com.smartscrm.server.mapper.AiRoleMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** B28 AI 角色（租户隔离）。name 租户内唯一；enabled=0 不参与。 */
@Service
public class AiRoleService {

    private final AiRoleMapper mapper;

    public AiRoleService(AiRoleMapper mapper) {
        this.mapper = mapper;
    }

    public List<AiRole> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<AiRole>()
            .eq(AiRole::getTenantId, tenantId)
            .orderByAsc(AiRole::getSort).orderByAsc(AiRole::getId));
    }

    @Transactional
    public AiRole create(Long tenantId, String name, String prompt, Integer enabled, Integer sort) {
        String n = requireName(name);
        if (exists(tenantId, n, null)) {
            throw new BizException(40000, "角色名已存在: " + n);
        }
        AiRole r = new AiRole();
        r.setTenantId(tenantId);
        r.setName(n);
        r.setPrompt(prompt);
        r.setEnabled(enabled == null ? 1 : (enabled == 0 ? 0 : 1));
        r.setSort(sort == null ? 0 : sort);
        mapper.insert(r);
        return r;
    }

    @Transactional
    public AiRole update(Long tenantId, Long id, String name, String prompt, Integer enabled, Integer sort) {
        AiRole existing = get(tenantId, id);
        if (name != null && !name.isBlank()) {
            String n = name.trim();
            if (exists(tenantId, n, id)) {
                throw new BizException(40000, "角色名已存在: " + n);
            }
            existing.setName(n);
        }
        if (prompt != null) existing.setPrompt(prompt);
        if (enabled != null) existing.setEnabled(enabled == 0 ? 0 : 1);
        if (sort != null) existing.setSort(sort);
        mapper.updateById(existing);
        return existing;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        mapper.deleteById(get(tenantId, id).getId());
    }

    private AiRole get(Long tenantId, Long id) {
        AiRole r = mapper.selectById(id);
        if (r == null || !tenantId.equals(r.getTenantId())) {
            throw new BizException(40404, "角色不存在: " + id);
        }
        return r;
    }

    private boolean exists(Long tenantId, String name, Long excludeId) {
        return mapper.selectCount(new LambdaQueryWrapper<AiRole>()
            .eq(AiRole::getTenantId, tenantId)
            .eq(AiRole::getName, name)
            .ne(excludeId != null, AiRole::getId, excludeId)) > 0;
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "name 不能为空");
        }
        return name.trim();
    }
}
