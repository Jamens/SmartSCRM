package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.ScriptActionTpl;
import com.smartscrm.server.entity.ScriptRole;
import com.smartscrm.server.entity.ScriptRoleCategory;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.ScriptRoleService;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** B8 剧本角色库（品类/角色/动作模板）CRUD。租户取自 JWT；A16 读=script:read 写=script:write。 */
@RestController
@RequestMapping("/api/script-roles")
public class ScriptRoleController {

    private final ScriptRoleService service;

    public ScriptRoleController(ScriptRoleService service) {
        this.service = service;
    }

    public record CategoryRequest(@NotBlank String name, Integer sort) {}
    public record RoleRequest(@NotBlank String name, Long categoryId, String prompt, Integer enabled, Integer sort) {}
    public record TplRequest(@NotBlank String name, @NotBlank String actionType, Long roleId, String params, Integer enabled) {}

    // ---------- 品类 ----------
    @GetMapping("/categories")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptRoleCategory>> categories(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.listCategories(p.tenantId()));
    }

    @PostMapping("/categories")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptRoleCategory> createCategory(@AuthenticationPrincipal AuthPrincipal p,
                                                        @RequestBody CategoryRequest r) {
        return ApiResponse.ok(service.createCategory(p.tenantId(), r.name(), r.sort()));
    }

    @PutMapping("/categories/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptRoleCategory> updateCategory(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                        @RequestBody CategoryRequest r) {
        return ApiResponse.ok(service.updateCategory(p.tenantId(), id, r.name(), r.sort()));
    }

    @DeleteMapping("/categories/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> deleteCategory(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.deleteCategory(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    // ---------- 角色 ----------
    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptRole>> roles(@AuthenticationPrincipal AuthPrincipal p,
                                               @RequestParam(required = false) Long categoryId) {
        return ApiResponse.ok(service.listRoles(p.tenantId(), categoryId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptRole> createRole(@AuthenticationPrincipal AuthPrincipal p, @RequestBody RoleRequest r) {
        return ApiResponse.ok(service.createRole(p.tenantId(), r.categoryId(), r.name(), r.prompt(), r.enabled(), r.sort()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptRole> updateRole(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                              @RequestBody RoleRequest r) {
        return ApiResponse.ok(service.updateRole(p.tenantId(), id, r.name(), r.prompt(), r.enabled(), r.sort()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> deleteRole(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.deleteRole(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    // ---------- 动作模板 ----------
    @GetMapping("/action-tpls")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptActionTpl>> tpls(@AuthenticationPrincipal AuthPrincipal p,
                                                    @RequestParam(required = false) Long roleId) {
        return ApiResponse.ok(service.listTpls(p.tenantId(), roleId));
    }

    @PostMapping("/action-tpls")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptActionTpl> createTpl(@AuthenticationPrincipal AuthPrincipal p, @RequestBody TplRequest r) {
        return ApiResponse.ok(service.createTpl(p.tenantId(), r.roleId(), r.actionType(), r.name(), r.params(), r.enabled()));
    }

    @PutMapping("/action-tpls/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptActionTpl> updateTpl(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                  @RequestBody TplRequest r) {
        return ApiResponse.ok(service.updateTpl(p.tenantId(), id, r.actionType(), r.name(), r.params(), r.enabled()));
    }

    @DeleteMapping("/action-tpls/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> deleteTpl(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.deleteTpl(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
