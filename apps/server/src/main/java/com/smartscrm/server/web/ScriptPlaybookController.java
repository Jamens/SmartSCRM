package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.ScriptPlaybookService;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** B8 剧本 + 步骤 CRUD。租户取自 JWT；A16 读=script:read 写=script:write。 */
@RestController
@RequestMapping("/api/script-playbooks")
public class ScriptPlaybookController {

    private final ScriptPlaybookService service;

    public ScriptPlaybookController(ScriptPlaybookService service) {
        this.service = service;
    }

    public record PlaybookRequest(@NotBlank String name, Long roleId, Integer enabled, Integer loopIntervalSec, String accountIds) {}
    public record StepRequest(@NotBlank String actionType, Integer seq, String params) {}

    @GetMapping
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptPlaybook>> list(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.list(p.tenantId()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptPlaybook> create(@AuthenticationPrincipal AuthPrincipal p, @RequestBody PlaybookRequest r) {
        return ApiResponse.ok(service.create(p.tenantId(), r.roleId(), r.name(), r.enabled(), r.loopIntervalSec(), r.accountIds()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptPlaybook> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                              @RequestBody PlaybookRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.name(), r.enabled(), r.loopIntervalSec(), r.accountIds()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    // ---------- 步骤 ----------
    @GetMapping("/{id}/steps")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<List<ScriptPlaybookStep>> steps(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        return ApiResponse.ok(service.listSteps(p.tenantId(), id));
    }

    @PostMapping("/{id}/steps")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptPlaybookStep> createStep(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                     @RequestBody StepRequest r) {
        return ApiResponse.ok(service.createStep(p.tenantId(), id, r.seq(), r.actionType(), r.params()));
    }

    @PutMapping("/steps/{stepId}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<ScriptPlaybookStep> updateStep(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long stepId,
                                                     @RequestBody StepRequest r) {
        return ApiResponse.ok(service.updateStep(p.tenantId(), stepId, r.actionType(), r.params()));
    }

    @DeleteMapping("/steps/{stepId}")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Void> deleteStep(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long stepId) {
        service.deleteStep(p.tenantId(), stepId);
        return ApiResponse.ok(null);
    }
}
