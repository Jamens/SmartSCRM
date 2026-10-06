package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.GroupJoinItem;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.GroupJoinService;
import jakarta.validation.constraints.NotBlank;
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
 * B18 加群任务（租户取自 JWT）。A16 读=script:read 写=script:write。
 *
 * <p>任务建完是 pending，**必须先 confirm（人工门）**才允许进执行链。
 */
@RestController
@RequestMapping("/api/group-join-tasks")
public class GroupJoinController {

    private final GroupJoinService service;

    public GroupJoinController(GroupJoinService service) {
        this.service = service;
    }

    public record CreateRequest(Long accountId, String name, @NotBlank String inviteCodes,
                               Integer intervalMinSec, Integer intervalMaxSec, Integer jitterPct) {}

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<GroupJoinTask>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<GroupJoinTask> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody CreateRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.accountId(), r.name(), r.inviteCodes(),
            r.intervalMinSec(), r.intervalMaxSec(), r.jitterPct()));
    }

    @GetMapping("/{id}/items")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<GroupJoinItem>> items(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.listItems(p.tenantId(), id));
    }

    /** 人工门：确认任务（pending → confirmed）。 */
    @PostMapping("/{id}/confirm")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<GroupJoinTask> confirm(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.confirm(p.tenantId(), id));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> cancel(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.cancel(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
