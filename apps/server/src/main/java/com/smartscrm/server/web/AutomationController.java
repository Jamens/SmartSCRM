package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AutomationService;
import com.smartscrm.server.web.vo.AutomationOverviewVO;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * B20 自动化任务面板（租户取自 JWT）。A16：读=script:read 写=script:write。
 * 只读聚合 + 账号批量关闭/删除；删除**先停任务再删**（spec §5）。
 */
@RestController
@RequestMapping("/api/automation")
public class AutomationController {

    private final AutomationService service;

    public AutomationController(AutomationService service) {
        this.service = service;
    }

    public record AccountsRequest(List<Long> accountIds) {}

    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('script:read')")
    public ApiResponse<AutomationOverviewVO> overview(@AuthenticationPrincipal AuthPrincipal p) {
        return ApiResponse.ok(service.overview(p.tenantId()));
    }

    /** 批量关闭：停账号 + 停其上在跑任务（可恢复）。 */
    @PostMapping("/accounts/close")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Map<String, Object>> close(@AuthenticationPrincipal AuthPrincipal p,
                                                 @RequestBody AccountsRequest r) {
        service.closeAccounts(p.tenantId(), r.accountIds());
        return ApiResponse.ok(Map.of("ok", true));
    }

    /** 批量删除：先停任务再删账号（不可逆，前端应二次确认并展示将停掉的任务数）。 */
    @PostMapping("/accounts/delete")
    @PreAuthorize("hasAuthority('script:write')")
    public ApiResponse<Map<String, Object>> delete(@AuthenticationPrincipal AuthPrincipal p,
                                                   @RequestBody AccountsRequest r) {
        int stopped = service.deleteAccounts(p.tenantId(), r.accountIds());
        return ApiResponse.ok(Map.of("ok", true, "stoppedTasks", stopped));
    }
}
