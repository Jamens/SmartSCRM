package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.GroupJoinItem;
import com.smartscrm.server.entity.GroupKickItem;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.GroupOpsExecutorService;
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
 * B18/B19 执行链端点（给桌面端驱动调用）。
 *
 * <p>两条路径严格分开：
 * <ul>
 *   <li><b>next</b>：桌面端取下一个待办（**服务端在这里判人工门**，未确认/未审阅直接拒）；</li>
 *   <li><b>report</b>：桌面端回填结果，服务端更新计数与任务状态。</li>
 * </ul>
 * 真正动 WhatsApp 的动作在注入层（wa-js），不在这里。
 */
@RestController
@RequestMapping("/api/group-ops")
public class GroupOpsExecutorController {

    private final GroupOpsExecutorService service;

    public GroupOpsExecutorController(GroupOpsExecutorService service) {
        this.service = service;
    }

    public record JoinReport(@org.springframework.web.bind.annotation.RequestParam Long itemId, boolean ok,
                             String groupId, Boolean pendingApproval, String error) {}
    public record KickReport(@org.springframework.web.bind.annotation.RequestParam Long itemId,
                             String outcome, String error) {}

    // ==================== B18 加群 ====================

    /** 取加群任务的下一个待办。**未 confirmed 的任务在这里被拒**（人工门第二道）。 */
    @GetMapping("/join/next")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<GroupJoinItem> nextJoin(@AuthenticationPrincipal AuthPrincipal p,
                                               @org.springframework.web.bind.annotation.RequestParam Long taskId) {
        return ApiResponse.ok(service.claimNextJoinItem(p.tenantId(), taskId));
    }

    /** 加群结果回填。pendingApproval 也算 joined（已提交审核）。 */
    @PostMapping("/join/report")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> reportJoin(@AuthenticationPrincipal AuthPrincipal p,
                                        @org.springframework.web.bind.annotation.RequestParam Long taskId,
                                        @RequestBody JoinReport r) {
        service.reportJoinResult(p.tenantId(), taskId, r.itemId(), r.ok(), r.groupId(),
            r.pendingApproval() == Boolean.TRUE, r.error());
        return ApiResponse.ok(null);
    }

    // ==================== B19 踢人 ====================

    /** 取踢人任务的下一个待踢。**未 approved 的任务在这里被拒**（人工门第二道）。 */
    @GetMapping("/kick/next")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<GroupKickItem> nextKick(@AuthenticationPrincipal AuthPrincipal p,
                                               @org.springframework.web.bind.annotation.RequestParam Long taskId) {
        return ApiResponse.ok(service.claimNextKickItem(p.tenantId(), taskId));
    }

    /** 踢人结果回填。outcome=removed|skipped|failed；skipped 是"能力不允许没踢"，不算失败。 */
    @PostMapping("/kick/report")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> reportKick(@AuthenticationPrincipal AuthPrincipal p,
                                        @org.springframework.web.bind.annotation.RequestParam Long taskId,
                                        @RequestBody KickReport r) {
        service.reportKickResult(p.tenantId(), taskId, r.itemId(), r.outcome(), r.error());
        return ApiResponse.ok(null);
    }
}
