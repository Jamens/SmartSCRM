package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.CloudPhone;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CloudPhoneService;
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

/**
 * B10 云手机（租户取自 JWT）。A16：读=cloudphone:read 写=cloudphone:write（V37 播种给 tenant_admin）。
 * v1：设备管理 CRUD；拉流纯前端 canvas，无后端端点。
 */
@RestController
@RequestMapping("/api/cloud-phones")
public class CloudPhoneController {

    private final CloudPhoneService service;

    public CloudPhoneController(CloudPhoneService service) {
        this.service = service;
    }

    public record UpsertRequest(
        @NotBlank String name,
        String provider,
        String host,
        String status,
        String androidVersion,
        String resolution,
        Integer streamSeed,
        String remark) {}

    @GetMapping
    @PreAuthorize("hasAuthority('cloudphone:read')")
    public ApiResponse<List<CloudPhone>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('cloudphone:write')")
    public ApiResponse<CloudPhone> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.name(), r.provider(), r.host(),
            r.status(), r.androidVersion(), r.resolution(), r.streamSeed(), r.remark()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudphone:write')")
    public ApiResponse<CloudPhone> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                         @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.name(), r.provider(), r.host(),
            r.status(), r.androidVersion(), r.resolution(), r.streamSeed(), r.remark()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudphone:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
