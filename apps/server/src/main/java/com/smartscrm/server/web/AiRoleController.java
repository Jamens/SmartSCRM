package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiRoleService;
import com.smartscrm.server.web.vo.AiRoleVO;
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
import org.springframework.web.bind.annotation.RestController;

/** B28 AI 角色（租户取自 JWT）。A16：读=knowledge:read / 写=knowledge:write。 */
@RestController
@RequestMapping("/api/ai-roles")
public class AiRoleController {

    private final AiRoleService service;

    public AiRoleController(AiRoleService service) {
        this.service = service;
    }

    public record RoleRequest(@NotBlank String name, String prompt, Integer enabled, Integer sort) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<AiRoleVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()).stream().map(AiRoleVO::of).toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiRoleVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                        @RequestBody RoleRequest req) {
        return ApiResponse.ok(AiRoleVO.of(
            service.create(principal.tenantId(), req.name(), req.prompt(), req.enabled(), req.sort())));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiRoleVO> update(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id,
                                        @RequestBody RoleRequest req) {
        return ApiResponse.ok(AiRoleVO.of(
            service.update(principal.tenantId(), id, req.name(), req.prompt(), req.enabled(), req.sort())));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
