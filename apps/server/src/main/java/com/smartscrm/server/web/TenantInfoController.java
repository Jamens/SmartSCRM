package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TenantInfoService;
import com.smartscrm.server.web.vo.PlanDefVO;
import com.smartscrm.server.web.vo.TenantInfoVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 桌面端当前租户套餐/用量快照（B24 首页卡片）。读自己所属的租户，不接 @PreAuthorize——
 * A16 的拦截器只在 handler 带 @PreAuthorize 时才查库，这里仅靠已认证的 AuthPrincipal 取 tenantId，
 * 调用方只能读到自己的租户，不会越权。
 */
@RestController
@RequestMapping("/api/tenant")
public class TenantInfoController {

    private final TenantInfoService service;

    public TenantInfoController(TenantInfoService service) {
        this.service = service;
    }

    @GetMapping("/info")
    public ApiResponse<TenantInfoVO> info(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.info(principal.tenantId()));
    }

    /**
     * B12 模拟支付门控：返回预设套餐目录，供前端渲染「升级 / 充值」选择列表。
     */
    @GetMapping("/plans")
    public ApiResponse<List<PlanDefVO>> plans() {
        return ApiResponse.ok(service.listPlans());
    }

    /**
     * B12 模拟支付门控：模拟支付宝支付完成后，把套餐限额写入当前租户。
     * 真实场景应由支付回调驱动，此处仅作演示，由已认证调用方直接触发（只能改到自己所属租户）。
     */
    @PostMapping("/activate-plan")
    public ApiResponse<TenantInfoVO> activatePlan(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ActivatePlanRequest req) {
        try {
            return ApiResponse.ok(service.activatePlan(principal.tenantId(), req.planCode()));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ApiResponse.error(400, e.getMessage());
        }
    }

    public record ActivatePlanRequest(@NotBlank String planCode) {
    }
}
