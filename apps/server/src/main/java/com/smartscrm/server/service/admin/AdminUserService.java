package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AdminUserMapper;
import com.smartscrm.server.mapper.TenantMapper;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Sub-account administration: listing, disabling, role assignment, creation, and
 * (B22) per-account port-limit and password reset.
 *
 * <p>Passwords are only ever written here as a fresh hash; the tenant-scoped auth
 * flow keeps its own change-password path so the desktop client behaviour is unchanged.
 */
@Service
public class AdminUserService {

    private final AdminUserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final TenantMapper tenantMapper;

    public AdminUserService(AdminUserMapper userMapper, PasswordEncoder passwordEncoder, TenantMapper tenantMapper) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.tenantMapper = tenantMapper;
    }

    /**
     * @param tenantId nullable; null lists accounts across every tenant
     * @param keyword substring match on username or nickname, nullable
     */
    public PageResult<UserRow> page(Long tenantId, String keyword, long page, long pageSize) {
        LambdaQueryWrapper<AppUser> w = new LambdaQueryWrapper<>();
        if (tenantId != null) {
            w.eq(AppUser::getTenantId, tenantId);
        }
        if (StringUtils.hasText(keyword)) {
            String kw = keyword.trim();
            w.and(x -> x.like(AppUser::getUsername, kw).or().like(AppUser::getNickname, kw));
        }
        w.orderByDesc(AppUser::getId);

        Page<AppUser> result = userMapper.selectPage(new Page<>(page, pageSize), w);
        List<UserRow> rows = result.getRecords().stream().map(AdminUserService::toRow).toList();
        return PageResult.of(rows, result.getTotal(), result.getCurrent(), result.getSize());
    }

    /** Replaces the user's role set in one shot. */
    public void assignRoles(Long userId, Set<Long> roleIds) {
        AppUser u = require(userId);
        Set<Long> ids = roleIds == null ? Set.of() : roleIds;

        userMapper.deleteRolesByUserId(userId);
        if (ids.isEmpty()) {
            return;
        }
        userMapper.insertRoles(userId, ids);
        u.getId();
    }

    public Set<Long> roleIds(Long userId) {
        return userMapper.roleIdsByUserId(userId);
    }

    public void setStatus(Long userId, Integer status) {
        if (status == null || (status != 0 && status != 1)) {
            throw new BizException(40001, "status must be 0 or 1", HttpStatus.BAD_REQUEST);
        }
        AppUser u = require(userId);
        u.setStatus(status);
        userMapper.updateById(u);
    }

    /**
     * Creates a sub-account. The initial password is hashed on the spot. When no
     * tenantId is supplied the caller's own tenant is used (tenant-scoped admins);
     * platform admins must pass one explicitly.
     *
     * @param operatorTenantId tenant id of the acting admin, or null for platform scope
     */
    public UserRow create(String username, String password, String nickname, Long tenantId,
                          String role, Integer status, Long operatorTenantId, Integer portLimit) {
        if (!StringUtils.hasText(username) || username.trim().length() > 64) {
            throw new BizException(40001, "username is required and must be under 64 chars", HttpStatus.BAD_REQUEST);
        }
        if (!StringUtils.hasText(password) || password.length() < 6) {
            throw new BizException(40001, "password must be at least 6 chars", HttpStatus.BAD_REQUEST);
        }
        Long tid = tenantId != null ? tenantId : operatorTenantId;
        if (tid == null) {
            throw new BizException(40001, "tenantId is required for a platform-scoped admin", HttpStatus.BAD_REQUEST);
        }
        validatePortLimit(portLimit, tid);

        AppUser u = new AppUser();
        u.setTenantId(tid);
        u.setUsername(username.trim());
        u.setPasswordHash(passwordEncoder.encode(password));
        u.setNickname(StringUtils.hasText(nickname) ? nickname.trim() : null);
        u.setRole(StringUtils.hasText(role) ? role : "agent");
        u.setStatus(status != null && (status == 0 || status == 1) ? status : 1);
        u.setPortLimit(portLimit);
        try {
            userMapper.insert(u);
        } catch (DataIntegrityViolationException e) {
            throw new BizException(40009, "username already exists in this scope", HttpStatus.BAD_REQUEST);
        }
        return toRow(u);
    }

    /**
     * Sets the per-account port upper limit. NULL restores "unlimited"; a concrete value
     * must be positive and may not exceed the owning tenant's seat_limit.
     */
    public void setPortLimit(Long id, Integer portLimit) {
        AppUser u = require(id);
        validatePortLimit(portLimit, u.getTenantId());
        u.setPortLimit(portLimit);
        userMapper.updateById(u);
    }

    /** Resets the account's password to a freshly hashed value. */
    public void resetPassword(Long id, String password) {
        if (!StringUtils.hasText(password) || password.length() < 6) {
            throw new BizException(40001, "password must be at least 6 chars", HttpStatus.BAD_REQUEST);
        }
        AppUser u = require(id);
        u.setPasswordHash(passwordEncoder.encode(password));
        userMapper.updateById(u);
    }

    /**
     * @param portLimit nullable; when set it must be >= 1 and <= the tenant's seat_limit
     *                  (a NULL seat_limit means the tenant has no upper bound).
     */
    private void validatePortLimit(Integer portLimit, Long tenantId) {
        if (portLimit == null) {
            return;
        }
        if (portLimit < 1) {
            throw new BizException(40001, "portLimit must be null or >= 1", HttpStatus.BAD_REQUEST);
        }
        Tenant t = tenantMapper.selectById(tenantId);
        if (t != null && t.getSeatLimit() != null && portLimit > t.getSeatLimit()) {
            throw new BizException(40001,
                    "portLimit " + portLimit + " exceeds tenant seat_limit " + t.getSeatLimit(), HttpStatus.BAD_REQUEST);
        }
    }

    /** Replaces the user's team membership in one shot. */
    public void assignTeams(Long userId, Set<Long> teamIds) {
        require(userId);
        Set<Long> ids = teamIds == null ? Set.of() : teamIds;
        userMapper.deleteTeamsByUserId(userId);
        if (!ids.isEmpty()) {
            userMapper.insertTeams(userId, ids);
        }
    }

    public Set<Long> teamIds(Long userId) {
        return userMapper.teamIdsByUserId(userId);
    }

    /**
     * Deletes a sub-account. Role and team memberships are removed first so the
     * cascade from {@code sys_user_role}/{@code sys_user_team} back-references is
     * deterministic; the user row itself is then dropped.
     */
    public void delete(Long id) {
        require(id);
        userMapper.deleteRolesByUserId(id);
        userMapper.deleteTeamsByUserId(id);
        userMapper.deleteById(id);
    }

    private AppUser require(Long id) {
        AppUser u = userMapper.selectById(id);
        if (u == null) {
            throw new BizException(40400, "user not found: " + id, HttpStatus.NOT_FOUND);
        }
        return u;
    }

    private static UserRow toRow(AppUser u) {
        return new UserRow(u.getId(), u.getTenantId(), u.getUsername(), u.getNickname(), u.getRole(), u.getStatus(), u.getPortLimit());
    }

    /** Sub-account as exposed to the admin console; never includes the password hash. */
    public record UserRow(Long id, Long tenantId, String username, String nickname, String role, Integer status, Integer portLimit) {}
}
