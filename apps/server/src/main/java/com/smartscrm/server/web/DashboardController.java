package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.DashboardService;
import com.smartscrm.server.web.vo.DashboardVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * B11 报表仪表盘（租户取自 JWT）。A16：读=message:read（报表是"看消息/账号"的业务面）。
 * 一次 overview 拿齐首页所有指标 + 天级消息趋势（days 缺省 7，上限 90）。
 */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService service;

    public DashboardController(DashboardService service) {
        this.service = service;
    }

    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('message:read')")
    public ApiResponse<DashboardVO> overview(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam(required = false) Integer days) {
        return ApiResponse.ok(service.overview(principal.tenantId(), days));
    }
}
