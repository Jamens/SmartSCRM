package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TenantInfoService;
import com.smartscrm.server.web.vo.TenantInfoVO;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
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
}
