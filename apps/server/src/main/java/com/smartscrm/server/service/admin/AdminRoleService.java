package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.SysRole;
import com.smartscrm.server.mapper.AdminRoleMapper;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** Role administration plus permission granting for the platform console. */
@Service
public class AdminRoleService {

    private final AdminRoleMapper roleMapper;

    public AdminRoleService(AdminRoleMapper roleMapper) {
        this.roleMapper = roleMapper;
    }

    /**
     * @param scope 1 platform / 2 tenant, nullable for all
     * @param tenantId required when scope is tenant, otherwise ignored
     */
    public PageResult<RoleRow> page(Integer scope, Long tenantId, long page, long pageSize) {
        LambdaQueryWrapper<SysRole> w = new LambdaQueryWrapper<>();
        if (scope != null) {
            w.eq(SysRole::getScope, scope);
        }
        if (tenantId != null) {
            w.eq(SysRole::getTenantId, tenantId);
        }
        w.orderByAsc(SysRole::getScope).orderByAsc(SysRole::getId);

        Page<SysRole> result = roleMapper.selectPage(new Page<>(page, pageSize), w);
        List<RoleRow> rows = result.getRecords().stream().map(AdminRoleService::toRow).toList();
        return PageResult.of(rows, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public RoleRow create(Integer scope, Long tenantId, String code, String name, Set<String> menuCodes) {
        requireCode(code);
        if (scope == null || (scope != 1 && scope != 2)) {
            throw new BizException(40001, "scope must be 1 (platform) or 2 (tenant)", HttpStatus.BAD_REQUEST);
        }
        if (scope == 2 && tenantId == null) {
            throw new BizException(40001, "tenantId is required for a tenant-scoped role", HttpStatus.BAD_REQUEST);
        }
        if (roleMapper.existsByScopeAndCode(scope, code.trim()) > 0) {
            throw new BizException(40002, "role code already exists in this scope: " + code, HttpStatus.BAD_REQUEST);
        }

        SysRole r = new SysRole();
        r.setTenantId(scope == 2 ? tenantId : null);
        r.setCode(code.trim());
        r.setName(StringUtils.hasText(name) ? name.trim() : code.trim());
        r.setScope(scope);
        r.setBuiltin(0);
        r.setStatus(1);
        roleMapper.insert(r);

        if (menuCodes != null && !menuCodes.isEmpty()) {
            grantMenus(r.getId(), menuCodes);
        }
        return toRow(r);
    }

    public void delete(Long id) {
        SysRole r = require(id);
        if (r.getBuiltin() != null && r.getBuiltin() == 1) {
            throw new BizException(40003, "builtin role cannot be deleted: " + r.getCode(), HttpStatus.BAD_REQUEST);
        }
        roleMapper.deleteMenusByRoleId(id);
        roleMapper.deleteById(id);
    }

    /**
     * Replaces the role's permission set. The whole request is validated before any
     * row changes, so a typo in one code cannot leave the role half-updated.
     */
    public void grantMenus(Long roleId, Set<String> menuCodes) {
        SysRole r = require(roleId);
        Set<String> codes = menuCodes == null ? Set.of() : menuCodes;
        if (!codes.isEmpty()) {
            long found = roleMapper.countMenusByCodes(codes);
            if (found != codes.size()) {
                throw new BizException(40004,
                        "unknown menu code(s) in grant request: expected " + codes.size() + " found " + found,
                        HttpStatus.BAD_REQUEST);
            }
        }

        roleMapper.deleteMenusByRoleId(roleId);
        if (codes.isEmpty()) {
            return;
        }
        List<Long> menuIds = roleMapper.menuIdsByCodes(codes);
        if (!menuIds.isEmpty()) {
            roleMapper.insertMenus(roleId, menuIds);
        }
        r.getId();
    }

    public Set<Long> grantedMenuIds(Long roleId) {
        return roleMapper.menuIdsByRoleId(roleId);
    }

    private void requireCode(String code) {
        if (!StringUtils.hasText(code) || code.trim().length() > 64) {
            throw new BizException(40001, "role code is required and must be under 64 chars", HttpStatus.BAD_REQUEST);
        }
    }

    private SysRole require(Long id) {
        SysRole r = roleMapper.selectById(id);
        if (r == null) {
            throw new BizException(40400, "role not found: " + id, HttpStatus.NOT_FOUND);
        }
        return r;
    }

    private static RoleRow toRow(SysRole r) {
        return new RoleRow(r.getId(), r.getTenantId(), r.getCode(), r.getName(), r.getScope(), r.getBuiltin(), r.getStatus());
    }

    /** Role as exposed to the admin console. */
    public record RoleRow(Long id, Long tenantId, String code, String name, Integer scope, Integer builtin, Integer status) {}
}
