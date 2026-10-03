package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.service.admin.AdminRoleService;
import com.smartscrm.server.service.admin.AdminRoleService.RoleRow;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Role administration and permission granting. */
@RestController
@RequestMapping("/api/admin/roles")
public class AdminRoleController {

    private final AdminRoleService roleService;

    public AdminRoleController(AdminRoleService roleService) {
        this.roleService = roleService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('role:list')")
    public ApiResponse<PageResult<RoleRow>> page(
        @RequestParam(required = false) Integer scope,
        @RequestParam(required = false) Long tenantId,
        @RequestParam(defaultValue = "1") long page,
        @RequestParam(defaultValue = "20") long pageSize
    ) {
        return ApiResponse.ok(roleService.page(scope, tenantId, page, pageSize));
    }

    @GetMapping("/{id}/menus")
    @PreAuthorize("hasAuthority('role:view')")
    public ApiResponse<Set<Long>> grantedMenus(@PathVariable Long id) {
        return ApiResponse.ok(roleService.grantedMenuIds(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('role:create')")
    public ApiResponse<RoleRow> create(@Valid @RequestBody RoleRequest req) {
        return ApiResponse.ok(roleService.create(req.scope(), req.tenantId(), req.code(), req.name(), req.menuCodes()));
    }

    @PutMapping("/{id}/menus")
    @PreAuthorize("hasAuthority('role:grant')")
    public ApiResponse<Void> grantMenus(@PathVariable Long id, @RequestBody GrantRequest req) {
        roleService.grantMenus(id, req == null || req.menuCodes() == null ? Set.of() : req.menuCodes());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('role:delete')")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        roleService.delete(id);
        return ApiResponse.ok(null);
    }

    /** Create-or-update payload for a role. */
    public record RoleRequest(
        @NotNull Integer scope,
        Long tenantId,
        @NotBlank String code,
        String name,
        Set<String> menuCodes
    ) {}

    /** Permission grant payload, carrying menu codes rather than ids. */
    public record GrantRequest(Set<String> menuCodes) {}
}
