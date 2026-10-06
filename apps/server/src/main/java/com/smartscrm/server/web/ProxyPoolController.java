package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.ProxyPool;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.ProxyPoolService;
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
 * B13 代理池（租户取自 JWT）。A16：读=proxy:read 写=proxy:write（V40 播种给 tenant_admin）。
 * v1：代理 CRUD + 模拟出口探测（/{id}/test，不发起真实外连，见 service.probe 注释）。
 */
@RestController
@RequestMapping("/api/proxy-pool")
public class ProxyPoolController {

    private final ProxyPoolService service;

    public ProxyPoolController(ProxyPoolService service) {
        this.service = service;
    }

    public record UpsertRequest(
        @NotBlank String name,
        @NotBlank String host,
        Integer port,
        String protocol,
        String username,
        String password,
        String status,
        String remark) {}

    @GetMapping
    @PreAuthorize("hasAuthority('proxy:read')")
    public ApiResponse<List<ProxyPool>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('proxy:write')")
    public ApiResponse<ProxyPool> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.name(), r.host(), r.port(),
            r.protocol(), r.username(), r.password(), r.status(), r.remark()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('proxy:write')")
    public ApiResponse<ProxyPool> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                         @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.name(), r.host(), r.port(),
            r.protocol(), r.username(), r.password(), r.status(), r.remark()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('proxy:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    /** 模拟出口探测（会话出口 IP 探测 + 按 IP 查归属地）。写回探测结果，故归 proxy:write。 */
    @PostMapping("/{id}/test")
    @PreAuthorize("hasAuthority('proxy:write')")
    public ApiResponse<ProxyPool> test(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.probe(p.tenantId(), id));
    }
}
