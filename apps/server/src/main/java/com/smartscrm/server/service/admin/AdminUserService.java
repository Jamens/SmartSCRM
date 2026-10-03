package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.mapper.AdminUserMapper;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Sub-account administration: listing, disabling, and role assignment.
 *
 * <p>Nothing here changes passwords -- that stays in the tenant-scoped auth flow so
 * the desktop client keeps its existing behaviour.
 */
@Service
public class AdminUserService {

    private final AdminUserMapper userMapper;

    public AdminUserService(AdminUserMapper userMapper) {
        this.userMapper = userMapper;
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

    private AppUser require(Long id) {
        AppUser u = userMapper.selectById(id);
        if (u == null) {
            throw new BizException(40400, "user not found: " + id, HttpStatus.NOT_FOUND);
        }
        return u;
    }

    private static UserRow toRow(AppUser u) {
        return new UserRow(u.getId(), u.getTenantId(), u.getUsername(), u.getNickname(), u.getRole(), u.getStatus());
    }

    /** Sub-account as exposed to the admin console; never includes the password hash. */
    public record UserRow(Long id, Long tenantId, String username, String nickname, String role, Integer status) {}
}
