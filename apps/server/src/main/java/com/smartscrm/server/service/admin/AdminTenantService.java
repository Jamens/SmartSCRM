package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AdminTenantMapper;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
        List<Tenant> records = result.getRecords();
        List<TenantRow> rows;
        if (records.isEmpty()) {
            rows = List.of();
        } else {
            List<Long> ids = records.stream().map(Tenant::getId).toList();
            Map<Long, Long> used = tenantMapper.userCountsByTenantIds(ids).stream()
                    .collect(HashMap::new, (m, c) -> m.put(c.tenantId(), c.cnt()), HashMap::putAll);
            rows = records.stream()
                    .map(t -> toRow(t, used.getOrDefault(t.getId(), 0L)))
                    .toList();
        }
        return PageResult.of(rows, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public TenantRow detail(Long id) {
        Tenant t = require(id);
        return toRow(t, tenantMapper.countUsers(t.getId()));
    }

    /**
     * Sets the seat quota. A {@code null} value restores unlimited; any other
     * value must be a non-negative integer capped at {@link #MAX_SEAT_LIMIT}.
     *
     * @param id tenant id
     * @param seatLimit null for unlimited, otherwise 0..MAX_SEAT_LIMIT
     */
    public TenantRow setQuota(Long id, Integer seatLimit) {
        if (seatLimit != null && (seatLimit < 0 || seatLimit > MAX_SEAT_LIMIT)) {
            throw new BizException(40001,
                    "seatLimit must be null or between 0 and " + MAX_SEAT_LIMIT, HttpStatus.BAD_REQUEST);
        }
        Tenant t = require(id);
        t.setSeatLimit(seatLimit);
        tenantMapper.updateById(t);
        return toRow(t, tenantMapper.countUsers(t.getId()));
    }

    /**
     * Deletes a tenant. Refused while the tenant still owns users or platform
     * accounts -- those would otherwise be orphaned. Callers must re-home or
     * remove the members first.
     */
    public void delete(Long id) {
        Tenant t = require(id);
        long users = tenantMapper.countUsers(t.getId());
        long accounts = tenantMapper.countPlatformAccounts(t.getId());
        if (users > 0 || accounts > 0) {
            throw new BizException(40001,
                    "tenant still has " + users + " user(s) and " + accounts
                            + " platform account(s); remove them before deletion",
                    HttpStatus.BAD_REQUEST);
        }
        tenantMapper.deleteById(t.getId());
    }

    private static final int MAX_SEAT_LIMIT = 100000;

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

    /**
     * Creates a tenant. An invite code is generated when omitted and is guaranteed
     * unique against the existing set.
     *
     * @param name tenant display name
     * @param inviteCode optional explicit invite code; must be unique if provided
     */
    public TenantRow create(String name, String inviteCode) {
        if (!StringUtils.hasText(name) || name.trim().length() > 128) {
            throw new BizException(40001, "name is required and must be under 128 chars", HttpStatus.BAD_REQUEST);
        }
        String code = StringUtils.hasText(inviteCode) ? inviteCode.trim() : null;
        if (code != null && tenantMapper.selectCount(new LambdaQueryWrapper<Tenant>().eq(Tenant::getInviteCode, code)) > 0) {
            throw new BizException(40001, "invite code already exists: " + code, HttpStatus.BAD_REQUEST);
        }
        if (code == null) {
            code = generateInviteCode();
            int tries = 0;
            while (tenantMapper.selectCount(new LambdaQueryWrapper<Tenant>().eq(Tenant::getInviteCode, code)) > 0 && tries++ < 8) {
                code = generateInviteCode();
            }
            if (tenantMapper.selectCount(new LambdaQueryWrapper<Tenant>().eq(Tenant::getInviteCode, code)) > 0) {
                throw new BizException(50000, "failed to allocate a unique invite code", HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }

        Tenant t = new Tenant();
        t.setInviteCode(code);
        t.setName(name.trim());
        t.setStatus(1);
        tenantMapper.insert(t);
        return toRow(t, 0L);
    }

    private static final String INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private String generateInviteCode() {
        java.security.SecureRandom rnd = new java.security.SecureRandom();
        StringBuilder sb = new StringBuilder("T");
        for (int i = 0; i < 7; i++) {
            sb.append(INVITE_ALPHABET.charAt(rnd.nextInt(INVITE_ALPHABET.length())));
        }
        return sb.toString();
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

    private static TenantRow toRow(Tenant t, long seatUsed) {
        return new TenantRow(t.getId(), t.getInviteCode(), t.getName(), t.getStatus(), t.getSeatLimit(), seatUsed, t.getCreatedAt());
    }

    /** Tenant as exposed to the admin console. */
    public record TenantRow(Long id, String inviteCode, String name, Integer status, Integer seatLimit, Long seatUsed, LocalDateTime createdAt) {}

    /** Per-tenant aggregate counts. */
    public record TenantCounts(long users, long platformAccounts) {}
}
