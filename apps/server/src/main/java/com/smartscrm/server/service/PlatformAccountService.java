package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class PlatformAccountService {

    private final PlatformAccountMapper mapper;

    public PlatformAccountService(PlatformAccountMapper mapper) {
        this.mapper = mapper;
    }

    public List<PlatformAccount> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .orderByAsc(PlatformAccount::getId));
    }

    public PlatformAccount create(Long tenantId, PlatformAccount body) {
        body.setId(null);
        body.setTenantId(tenantId);
        if (body.getViewId() == null || body.getViewId().isBlank()) {
            body.setViewId(UUID.randomUUID().toString());
        }
        if (existsViewId(tenantId, body.getViewId(), null)) {
            throw new BizException(40901, "该账号视图已存在");
        }
        body.setStatus(body.getStatus() == null ? 0 : body.getStatus());
        mapper.insert(body);
        return mapper.selectById(body.getId());
    }

    public PlatformAccount update(Long tenantId, Long id, PlatformAccount body) {
        PlatformAccount existing = requireOwned(tenantId, id);
        existing.setPlatformType(body.getPlatformType());
        existing.setName(body.getName());
        existing.setPhone(body.getPhone());
        existing.setAvatar(body.getAvatar());
        existing.setRemark(body.getRemark());
        mapper.updateById(existing);
        return mapper.selectById(id);
    }

    public void delete(Long tenantId, Long id) {
        requireOwned(tenantId, id);
        mapper.deleteById(id);
    }

    public void updateStatus(Long tenantId, Long id, Integer status) {
        PlatformAccount account = requireOwned(tenantId, id);
        account.setStatus(status);
        if (status != null && status == 1) {
            account.setLastLoginAt(LocalDateTime.now());
        }
        mapper.updateById(account);
    }

    private PlatformAccount requireOwned(Long tenantId, Long id) {
        PlatformAccount account = mapper.selectById(id);
        if (account == null || !account.getTenantId().equals(tenantId)) {
            throw new BizException(40404, "账号不存在");
        }
        return account;
    }

    private boolean existsViewId(Long tenantId, String viewId, Long excludeId) {
        return mapper.exists(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .eq(PlatformAccount::getViewId, viewId)
            .ne(excludeId != null, PlatformAccount::getId, excludeId));
    }
}
