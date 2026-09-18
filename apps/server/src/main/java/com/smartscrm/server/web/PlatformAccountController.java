package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.PlatformAccountService;
import com.smartscrm.server.web.dto.PlatformAccountRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/platform-accounts")
public class PlatformAccountController {

    private final PlatformAccountService service;

    public PlatformAccountController(PlatformAccountService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<PlatformAccount>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()));
    }

    @PostMapping
    public ApiResponse<PlatformAccount> create(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody PlatformAccountRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), toEntity(req)));
    }

    @PutMapping("/{id}")
    public ApiResponse<PlatformAccount> update(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id,
                                               @Valid @RequestBody PlatformAccountRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), id, toEntity(req)));
    }

    @PatchMapping("/{id}/status")
    public ApiResponse<Void> updateStatus(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable Long id,
                                          @RequestBody StatusRequest req) {
        service.updateStatus(principal.tenantId(), id, req.status());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    private PlatformAccount toEntity(PlatformAccountRequest req) {
        PlatformAccount account = new PlatformAccount();
        account.setPlatformType(req.platformType());
        account.setName(req.name());
        account.setPhone(req.phone());
        account.setAvatar(req.avatar());
        account.setViewId(req.viewId());
        account.setRemark(req.remark());
        return account;
    }

    public record StatusRequest(Integer status) {
    }
}
