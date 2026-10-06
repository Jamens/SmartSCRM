package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.NurtureRun;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.NurtureExecutorService;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * B9 养号执行链（给桌面端驱动调用）。Java 只编排，真发消息在注入层（wa-js sendTextMessage）。
 * A16：读=script:read 写=script:write。
 */
@RestController
@RequestMapping("/api/nurture-runs")
public class NurtureRunController {

    private final NurtureExecutorService service;

    public NurtureRunController(NurtureExecutorService service) {
        this.service = service;
    }

    public record ReportRequest(boolean ok, String msgKey, String error) {}

    /** 取待发列表（置 sending 占位），桌面端按 accountId 找到各自 view 派发。 */
    @GetMapping("/pending")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<NurtureRun>> pending(@AuthenticationPrincipal AuthPrincipal p,
                                                @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(service.claimPending(p.tenantId(), limit));
    }

    /** 回报发言结果。 */
    @PostMapping("/{id}/report")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> report(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                    @RequestBody ReportRequest r) {
        service.reportResult(p.tenantId(), id, r.ok(), r.msgKey(), r.error());
        return ApiResponse.ok(null);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<NurtureRun>> list(@AuthenticationPrincipal AuthPrincipal p,
                                               @RequestParam(required = false) Long planId) {
        return ApiResponse.ok(service.listRuns(p.tenantId(), planId));
    }
}
