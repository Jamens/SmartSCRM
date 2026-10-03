package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AdminTenantMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Tenant administration for the platform console.
 *
 * <p>This service never filters by tenant: platform administrators manage every
 * tenant, which is the whole reason the admin package is separate from the
 * tenant-scoped services used by the desktop client.
 */
@Service
public class AdminTenantService {

    private final AdminTenantMapper tenantMapper;

    public AdminTenantService(AdminTenantMapper tenantMapper) {
        this.tenantMapper = tenantMapper;
    }

    /**
     * Paginated tenant list, optionally filtered by name and status.
     *
     * @param keyword substring match on tenant name, nullable
     * @param status 1 active / 0 suspended, nullable
     */
    public PageResult<TenantRow> page(String keyword, Integer status, long page, long pageSize) {
        LambdaQueryWrapper<Tenant> w = new LambdaQueryWrapper<>();
        if (StringUtils.hasText(keyword)) {
            w.like(Tenant::getName, keyword.trim());
        }
        if (status != null) {
            w.eq(Tenant::getStatus, status);
        }
        w.orderByDesc(Tenant::getId);

        Page<Tenant> result = tenantMapper.selectPage(new Page<>(page, pageSize), w);
        List<TenantRow> rows = result.getRecords().stream().map(AdminTenantService::toRow).toList();
        return PageResult.of(rows, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public TenantRow detail(Long id) {
        return toRow(require(id));
    }

    public void setStatus(Long id, Integer status) {
        if (status == null || (status != 0 && status != 1)) {
            throw new BizException(40001, "status must be 0 or 1", HttpStatus.BAD_REQUEST);
        }
        Tenant t = require(id);
        t.setStatus(status);
        tenantMapper.updateById(t);
    }

    public void rename(Long id, String name) {
        if (!StringUtils.hasText(name) || name.trim().length() > 128) {
            throw new BizException(40001, "name is required and must be under 128 chars", HttpStatus.BAD_REQUEST);
        }
        Tenant t = require(id);
        t.setName(name.trim());
        tenantMapper.updateById(t);
    }

    /** Aggregate counts shown on the tenant detail page. */
    public TenantCounts counts(Long tenantId) {
        return new TenantCounts(
                tenantMapper.countUsers(tenantId),
                tenantMapper.countPlatformAccounts(tenantId));
    }

    private Tenant require(Long id) {
        Tenant t = tenantMapper.selectById(id);
        if (t == null) {
            throw new BizException(40400, "tenant not found: " + id, HttpStatus.NOT_FOUND);
        }
        return t;
    }

    private static TenantRow toRow(Tenant t) {
        return new TenantRow(t.getId(), t.getInviteCode(), t.getName(), t.getStatus(), t.getCreatedAt());
    }

    /** Tenant as exposed to the admin console. */
    public record TenantRow(Long id, String inviteCode, String name, Integer status, LocalDateTime createdAt) {}

    /** Per-tenant aggregate counts. */
    public record TenantCounts(long users, long platformAccounts) {}
}
