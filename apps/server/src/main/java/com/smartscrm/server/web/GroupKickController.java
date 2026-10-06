package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.GroupKickItem;
import com.smartscrm.server.entity.GroupKickTask;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.GroupKickService;
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
 * B19 踢人任务（租户取自 JWT）。A16 读=script:read 写=script:write。
 *
 * <p>名单建完 approvalStatus=pending，**必须先 approve（人工门）**才允许进执行链。
 */
@RestController
@RequestMapping("/api/group-kick-tasks")
public class GroupKickController {

    private final GroupKickService service;

    public GroupKickController(GroupKickService service) {
        this.service = service;
    }

    public record CreateRequest(Long accountId, @NotBlank String groupId, String name,
                               String rule, @NotBlank List<String> participantIds) {}

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<GroupKickTask>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<GroupKickTask> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody CreateRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.accountId(), r.groupId(), r.name(),
            r.rule(), r.participantIds()));
    }

    @GetMapping("/{id}/items")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<GroupKickItem>> items(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.listItems(p.tenantId(), id));
    }

    /** 人工门：批准名单（pending → approved）。 */
    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<GroupKickTask> approve(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.approve(p.tenantId(), id));
    }

    /** 人工门：驳回名单（pending → rejected）。 */
    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<GroupKickTask> reject(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.reject(p.tenantId(), id));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> cancel(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.cancel(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
