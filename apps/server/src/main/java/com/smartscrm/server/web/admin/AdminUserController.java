package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.admin.AdminUserService;
import com.smartscrm.server.service.admin.AdminUserService.UserRow;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Sub-account administration: listing, disabling, role/team assignment, and creation. */
@RestController
@RequestMapping("/api/admin/users")
public class AdminUserController {

    private final AdminUserService userService;

    public AdminUserController(AdminUserService userService) {
        this.userService = userService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('user:list')")
    public ApiResponse<PageResult<UserRow>> page(
        @RequestParam(required = false) Long tenantId,
        @RequestParam(required = false) String keyword,
        @RequestParam(defaultValue = "1") long page,
        @RequestParam(defaultValue = "20") long pageSize
    ) {
        return ApiResponse.ok(userService.page(tenantId, keyword, page, pageSize));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('user:create')")
    public ApiResponse<UserRow> create(@AuthenticationPrincipal AuthPrincipal principal, @RequestBody UserCreateRequest req) {
        Long operatorTenantId = principal == null ? null : principal.tenantId();
        return ApiResponse.ok(userService.create(
                req.username(), req.password(), req.nickname(), req.tenantId(),
                req.role(), req.status(), operatorTenantId));
    }

    @GetMapping("/{id}/roles")
    @PreAuthorize("hasAuthority('user:view')")
    public ApiResponse<Set<Long>> roles(@PathVariable Long id) {
        return ApiResponse.ok(userService.roleIds(id));
    }

    @PutMapping("/{id}/roles")
    @PreAuthorize("hasAuthority('user:assignRole')")
    public ApiResponse<Void> assignRoles(@PathVariable Long id, @RequestBody RoleAssignRequest req) {
        userService.assignRoles(id, req == null || req.roleIds() == null ? Set.of() : req.roleIds());
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/teams")
    @PreAuthorize("hasAuthority('user:view')")
    public ApiResponse<Set<Long>> teams(@PathVariable Long id) {
        return ApiResponse.ok(userService.teamIds(id));
    }

    @PutMapping("/{id}/teams")
    @PreAuthorize("hasAuthority('user:assignTeam')")
    public ApiResponse<Void> assignTeams(@PathVariable Long id, @RequestBody TeamAssignRequest req) {
        userService.assignTeams(id, req == null || req.teamIds() == null ? Set.of() : req.teamIds());
        return ApiResponse.ok(null);
    }

    @PutMapping("/{id}/status")
    @PreAuthorize("hasAuthority('user:update')")
    public ApiResponse<Void> setStatus(@PathVariable Long id, @RequestParam Integer status) {
        userService.setStatus(id, status);
        return ApiResponse.ok(null);
    }

    /** Role assignment payload. */
    public record RoleAssignRequest(Set<Long> roleIds) {}

    /** Team assignment payload. */
    public record TeamAssignRequest(Set<Long> teamIds) {}

    /** Sub-account creation payload. */
    public record UserCreateRequest(String username, String password, String nickname, Long tenantId, String role, Integer status) {}
}
