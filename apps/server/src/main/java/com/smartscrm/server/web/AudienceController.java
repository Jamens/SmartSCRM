package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AudienceService;
import com.smartscrm.server.web.dto.AudienceRequest;
import com.smartscrm.server.web.vo.AudienceVO;
import com.smartscrm.server.web.vo.CustomerVO;
import jakarta.validation.Valid;
import java.util.List;
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

@RestController
@RequestMapping("/api/audiences")
public class AudienceController {

    private final AudienceService service;

    public AudienceController(AudienceService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<AudienceVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()));
    }

    @GetMapping("/{id}")
    public ApiResponse<AudienceVO> detail(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        return ApiResponse.ok(service.detail(principal.tenantId(), id));
    }

    @GetMapping("/{id}/customers")
    public ApiResponse<PageResult<CustomerVO>> customers(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable Long id,
                                                         @RequestParam(defaultValue = "1") long page,
                                                         @RequestParam(defaultValue = "20") long pageSize) {
        return ApiResponse.ok(service.customers(principal.tenantId(), id, page, pageSize));
    }

    @PostMapping
    public ApiResponse<AudienceVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                          @Valid @RequestBody AudienceRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), req));
    }

    @PutMapping("/{id}")
    public ApiResponse<AudienceVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable Long id,
                                          @Valid @RequestBody AudienceRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
