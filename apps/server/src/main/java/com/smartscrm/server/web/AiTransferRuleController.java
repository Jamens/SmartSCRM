package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiTransferRuleService;
import com.smartscrm.server.web.dto.AiTransferRuleDTO;
import com.smartscrm.server.web.vo.AiTransferRuleVO;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * B28 P2 — tenant-scoped AI transfer-to-human rule management.
 *
 * <p>Rules belong to a tenant; every endpoint is narrowed by the caller's {@code tenantId}
 * (resolved from the JWT, never trusted from the body). The rule config UI (B28 P3) and
 * the desktop takeover console (B28 P4) both consume these same endpoints.
 */
@RestController
@RequestMapping("/api/ai-transfer-rules")
public class AiTransferRuleController {

    private final AiTransferRuleService service;

    public AiTransferRuleController(AiTransferRuleService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<AiTransferRuleVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()).stream().map(AiTransferRuleVO::of).toList());
    }

    @PostMapping
    public ApiResponse<AiTransferRuleVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody AiTransferRuleDTO dto) {
        return ApiResponse.ok(AiTransferRuleVO.of(service.create(principal.tenantId(), dto)));
    }

    @GetMapping("/{id}")
    public ApiResponse<AiTransferRuleVO> get(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable Long id) {
        return ApiResponse.ok(AiTransferRuleVO.of(service.get(principal.tenantId(), id)));
    }

    @PutMapping("/{id}")
    public ApiResponse<AiTransferRuleVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id, @Valid @RequestBody AiTransferRuleDTO dto) {
        return ApiResponse.ok(AiTransferRuleVO.of(service.update(principal.tenantId(), id, dto)));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
