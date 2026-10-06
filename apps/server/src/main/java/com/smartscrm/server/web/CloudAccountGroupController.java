package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.CloudAccountGroup;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CloudAccountGroupService;
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

/** B21 云账号池 · 分组（租户取自 JWT）。A16：读=cloudaccount:read 写=cloudaccount:write（V44 播种）。 */
@RestController
@RequestMapping("/api/cloud-account-groups")
public class CloudAccountGroupController {

    private final CloudAccountGroupService service;

    public CloudAccountGroupController(CloudAccountGroupService service) {
        this.service = service;
    }

    public record GroupRequest(@NotBlank String name, String remark) {}

    @GetMapping
    @PreAuthorize("hasAuthority('cloudaccount:read')")
    public ApiResponse<List<CloudAccountGroup>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<CloudAccountGroup> create(@AuthenticationPrincipal AuthPrincipal p,
                                                 @RequestBody GroupRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.name(), r.remark()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<CloudAccountGroup> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                 @RequestBody GroupRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.name(), r.remark()));
    }

    /** 删分组：挂靠的云号会被置为未分组（见 service.delete），不留悬挂 group_id。 */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('cloudaccount:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
