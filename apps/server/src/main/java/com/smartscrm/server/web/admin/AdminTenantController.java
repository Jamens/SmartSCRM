package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.service.admin.AdminTenantService;
import com.smartscrm.server.service.admin.AdminTenantService.TenantCounts;
import com.smartscrm.server.service.admin.AdminTenantService.TenantRow;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tenant administration. Every handler is guarded by the same menu code the
 * frontend uses to render its controls, so hiding a button and rejecting the call
 * cannot drift apart.
 */
@RestController
@RequestMapping("/api/admin/tenants")
public class AdminTenantController {

    private final AdminTenantService tenantService;

    public AdminTenantController(AdminTenantService tenantService) {
        this.tenantService = tenantService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('tenant:list')")
    public ApiResponse<PageResult<TenantRow>> page(
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) Integer status,
        @RequestParam(defaultValue = "1") long page,
        @RequestParam(defaultValue = "20") long pageSize
    ) {
        return ApiResponse.ok(tenantService.page(keyword, status, page, pageSize));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('tenant:view')")
    public ApiResponse<TenantRow> detail(@PathVariable Long id) {
        return ApiResponse.ok(tenantService.detail(id));
    }

    @GetMapping("/{id}/counts")
    @PreAuthorize("hasAuthority('tenant:view')")
    public ApiResponse<TenantCounts> counts(@PathVariable Long id) {
        return ApiResponse.ok(tenantService.counts(id));
    }

    @PutMapping("/{id}/name")
    @PreAuthorize("hasAuthority('tenant:update')")
    public ApiResponse<Void> rename(@PathVariable Long id, @RequestParam String name) {
        tenantService.rename(id, name);
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/status")
    @PreAuthorize("hasAuthority('tenant:status')")
    public ApiResponse<Void> setStatus(@PathVariable Long id, @RequestParam Integer status) {
        tenantService.setStatus(id, status);
        return ApiResponse.ok(null);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('tenant:create')")
    public ApiResponse<TenantRow> create(@RequestBody TenantCreateRequest req) {
        return ApiResponse.ok(tenantService.create(req.name(), req.inviteCode()));
    }

    /** Tenant creation payload. */
    public record TenantCreateRequest(String name, String inviteCode) {}
}
