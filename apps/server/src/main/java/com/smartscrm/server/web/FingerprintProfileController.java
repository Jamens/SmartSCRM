package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.FingerprintProfile;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.FingerprintProfileService;
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
 * B14 浏览器指纹配置（租户取自 JWT）。A16：读=fingerprint:read 写=fingerprint:write（V42 播种给 tenant_admin）。
 * v1：指纹档案 CRUD + 模拟生成（/{id}/regenerate，不探测真实设备，见 service.generate 注释）。
 */
@RestController
@RequestMapping("/api/fingerprint-profiles")
public class FingerprintProfileController {

    private final FingerprintProfileService service;

    public FingerprintProfileController(FingerprintProfileService service) {
        this.service = service;
    }

    public record UpsertRequest(
        @NotBlank String name,
        String os,
        String browser,
        String status,
        String remark) {}

    @GetMapping
    @PreAuthorize("hasAuthority('fingerprint:read')")
    public ApiResponse<List<FingerprintProfile>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('fingerprint:write')")
    public ApiResponse<FingerprintProfile> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.name(), r.os(), r.browser(), r.status(), r.remark()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('fingerprint:write')")
    public ApiResponse<FingerprintProfile> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                 @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.name(), r.os(), r.browser(), r.status(), r.remark()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('fingerprint:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    /** 模拟生成/重新生成指纹（确定性派生，不探测真实设备）。写回生成结果，故归 fingerprint:write。 */
    @PostMapping("/{id}/regenerate")
    @PreAuthorize("hasAuthority('fingerprint:write')")
    public ApiResponse<FingerprintProfile> regenerate(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.generate(p.tenantId(), id));
    }
}
