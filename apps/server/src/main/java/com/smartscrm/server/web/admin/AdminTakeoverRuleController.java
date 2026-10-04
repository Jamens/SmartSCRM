package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiTransferRuleService;
import com.smartscrm.server.web.dto.AiTransferRuleDTO;
import com.smartscrm.server.web.vo.AiTransferRuleVO;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
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

/**
 * B28 P3 — admin-console view of the AI transfer-to-human rules.
 *
 * <p>Every handler is guarded by the same {@code ai_rule:*} code the console uses to
 * render its controls, so a hidden button and a rejected call cannot drift apart.
 *
 * <p>Rules are tenant data, so the tenant is resolved here rather than trusted from the
 * body: a tenant-scoped admin always operates on its own tenant and may not pass
 * another one, while a platform admin (no {@code tenantId} of its own) must name the
 * tenant explicitly. That asymmetry is the same rule {@code AdminUserService.create}
 * already applies, and it is why {@code tenantId} is a query/path parameter instead of
 * a field on the request body.
 */
@RestController
@RequestMapping("/api/admin/ai-rules")
public class AdminTakeoverRuleController {

    private final AiTransferRuleService ruleService;

    public AdminTakeoverRuleController(AiTransferRuleService ruleService) {
        this.ruleService = ruleService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('ai_rule:list')")
    public ApiResponse<List<AiTransferRuleVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @RequestParam(required = false) Long tenantId) {
        return ApiResponse.ok(ruleService.list(resolveTenant(principal, tenantId)).stream()
            .map(AiTransferRuleVO::of).toList());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('ai_rule:view')")
    public ApiResponse<AiTransferRuleVO> detail(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id,
                                               @RequestParam(required = false) Long tenantId) {
        return ApiResponse.ok(AiTransferRuleVO.of(ruleService.get(resolveTenant(principal, tenantId), id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('ai_rule:create')")
    public ApiResponse<AiTransferRuleVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam(required = false) Long tenantId,
                                               @Valid @RequestBody AiTransferRuleDTO dto) {
        return ApiResponse.ok(AiTransferRuleVO.of(
            ruleService.create(resolveTenant(principal, tenantId), dto)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('ai_rule:update')")
    public ApiResponse<AiTransferRuleVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id,
                                               @RequestParam(required = false) Long tenantId,
                                               @Valid @RequestBody AiTransferRuleDTO dto) {
        return ApiResponse.ok(AiTransferRuleVO.of(
            ruleService.update(resolveTenant(principal, tenantId), id, dto)));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('ai_rule:delete')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id,
                                    @RequestParam(required = false) Long tenantId) {
        ruleService.delete(resolveTenant(principal, tenantId), id);
        return ApiResponse.ok(null);
    }

    /**
     * Tenant rules: a caller bound to a tenant may only ever address that tenant (an
     * explicit different {@code tenantId} is refused rather than silently ignored, so a
     * frontend bug surfaces as 403 instead of quietly editing the wrong tenant's data);
     * a platform caller has no tenant of its own and must name one.
     */
    private static Long resolveTenant(AuthPrincipal principal, Long requested) {
        Long own = principal.tenantId();
        if (own == null) {
            if (requested == null) {
                throw new BizException(40001, "平台管理员必须指定 tenantId", HttpStatus.BAD_REQUEST);
            }
            return requested;
        }
        if (requested != null && !requested.equals(own)) {
            throw new BizException(40300, "只能管理本租户的转人工规则", HttpStatus.FORBIDDEN);
        }
        return own;
    }
}
