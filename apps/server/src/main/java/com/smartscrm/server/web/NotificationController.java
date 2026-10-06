package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.NotificationService;
import com.smartscrm.server.web.vo.NotificationVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * A10 消息中心 / 站内通知。
 *
 * <p>租户与用户都取自 JWT（{@code principal.tenantId()} / {@code principal.userId()}），
 * 绝不从请求体信任。写入口只有"已读"——投递由系统侧调 {@code NotificationService.publish}。
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService service;

    public NotificationController(NotificationService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('notification:read')")
    public ApiResponse<PageResult<NotificationVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                       @RequestParam(defaultValue = "1") long page,
                                                       @RequestParam(defaultValue = "20") long pageSize,
                                                       @RequestParam(defaultValue = "false") boolean unreadOnly) {
        var result = service.page(principal.tenantId(), principal.userId(), page, pageSize, unreadOnly);
        return ApiResponse.ok(PageResult.of(result.getRecords().stream().map(NotificationVO::of).toList(),
            result.getTotal(), result.getCurrent(), result.getSize()));
    }

    @GetMapping("/unread-count")
    @PreAuthorize("hasAuthority('notification:read')")
    public ApiResponse<Long> unreadCount(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.unreadCount(principal.tenantId(), principal.userId()));
    }

    @PutMapping("/{id}/read")
    @PreAuthorize("hasAuthority('notification:write')")
    public ApiResponse<Void> markRead(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.markRead(principal.tenantId(), principal.userId(), id);
        return ApiResponse.ok(null);
    }

    @PutMapping("/read-all")
    @PreAuthorize("hasAuthority('notification:write')")
    public ApiResponse<Integer> markAllRead(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.markAllRead(principal.tenantId(), principal.userId()));
    }
}
