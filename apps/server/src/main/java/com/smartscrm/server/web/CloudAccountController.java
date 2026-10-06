package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.CloudAccount;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CloudAccountService;
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
 * B21 云账号池 · 云账号（租户取自 JWT）。A16：读=cloudaccount:read 写=cloudaccount:write（V44 播种）。
 * v1：云号 CRUD + 批量转移（/transfer）+ 同步到本地（/{id}/sync，只写本地 platform_account，不外连）。
 */
@RestController
@RequestMapping("/api/cloud-accounts")
public class CloudAccountController {

    private final CloudAccountService service;

    public CloudAccountController(CloudAccountService service) {
        this.service = service;
    }

    public record UpsertRequest(
        @NotBlank String name,
        Long groupId,
        String phone,
        String platform,
        String status,
        String remark) {}

    public record TransferRequest(List<Long> ids, Long groupId) {}

    @GetMapping
    @PreAuthorize("hasAuthority('cloudaccount:read')")
    public ApiResponse<List<CloudAccount>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<CloudAccount> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.groupId(), r.name(), r.phone(),
            r.platform(), r.status(), r.remark()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<CloudAccount> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                            @RequestBody UpsertRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.groupId(), r.name(), r.phone(),
            r.platform(), r.status(), r.remark()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    /** 批量转移：把 ids 里的云号整体挪到 groupId 分组（groupId 为空 = 移出分组）。 */
    @PostMapping("/transfer")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<Integer> transfer(@AuthenticationPrincipal AuthPrincipal p,
                                         @RequestBody TransferRequest r) {
        return ApiResponse.ok(service.transfer(p.tenantId(), r.ids(), r.groupId()));
    }

    /** 同步到本地：落成一条本地 platform_account 记录并回写 syncedAt（纯本地写库，不外连）。 */
    @PostMapping("/{id}/sync")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<CloudAccount> sync(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.sync(p.tenantId(), id));
    }
}
