package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.ScriptTaskService;
import jakarta.validation.constraints.NotBlank;
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

/** B8 任务实例（起任务/查任务/手动推进/step 回报/心跳/取消）。A16 读=script:read 写=script:write。 */
@RestController
@RequestMapping("/api/script-tasks")
public class ScriptTaskController {

    private final ScriptTaskService service;

    public ScriptTaskController(ScriptTaskService service) {
        this.service = service;
    }

    public record StartRequest(Long playbookId, @NotBlank String targetChatKey, String targetGroupId) {}
    public record ReportRequest(int seq, @NotBlank String status, String errorCode, String errorDetail, String msgKey) {}

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptTask>> list(@AuthenticationPrincipal AuthPrincipal p,
                                             @RequestParam(required = false) Long playbookId) {
        return ApiResponse.ok(service.list(p.tenantId(), playbookId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptTask> start(@AuthenticationPrincipal AuthPrincipal p, @RequestBody StartRequest r) {
        return ApiResponse.ok(service.start(p.tenantId(), r.playbookId(), r.targetChatKey(), r.targetGroupId()));
    }

    @GetMapping("/{id}/steps")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptTaskStep>> steps(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.listSteps(p.tenantId(), id));
    }

    /** 手动推进一格（不等 next_run_at，前端「立即跑一步」/联调用）。 */
    @PostMapping("/{id}/advance")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Boolean> advance(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.advanceNow(p.tenantId(), id));
    }

    /** step 回报（桌面端执行器上报结果；P9-3 前端也可手动模拟）。 */
    @PostMapping("/{id}/report")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> report(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                    @RequestBody ReportRequest r) {
        service.reportStep(p.tenantId(), id, r.seq(), r.status(), r.errorCode(), r.errorDetail(), r.msgKey());
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/heartbeat")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> heartbeat(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.heartbeat(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> cancel(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.cancel(p.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
