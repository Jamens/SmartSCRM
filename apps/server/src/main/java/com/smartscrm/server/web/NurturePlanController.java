package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.NurturePlan;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.NurturePlanService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * B9 养号计划（租户取自 JWT）。A16：读=script:read 写=script:write。
 * 计划建完是 pending，**必须先 confirm（人工门）**才允许进执行链。
 */
@RestController
@RequestMapping("/api/nurture-plans")
public class NurturePlanController {

    private final NurturePlanService service;

    public NurturePlanController(NurturePlanService service) {
        this.service = service;
    }

    public record CreateRequest(
        String name,
        String groupChatKey,
        Boolean createGroup,
        @NotEmpty List<Long> accountIds,
        Integer perGroup,
        List<Long> materialIds,
        Long seed,
        @NotEmpty List<String> atPoints,
        Integer speakingRounds,
        Integer intervalMinSec,
        Integer intervalMaxSec,
        Integer jitterPct) {}

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<NurturePlan>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<NurturePlan> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody CreateRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.name(), r.groupChatKey(),
            Boolean.TRUE.equals(r.createGroup()), r.accountIds(), r.perGroup(), r.materialIds(), r.seed(),
            r.atPoints(), r.speakingRounds(), r.intervalMinSec(), r.intervalMaxSec(), r.jitterPct()));
    }

    /** 人工门：确认计划（pending → confirmed）。 */
    @PostMapping("/{id}/confirm")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<NurturePlan> confirm(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.confirm(p.tenantId(), id));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> cancel(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.cancel(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
