package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiNurtureSettingService;
import com.smartscrm.server.web.vo.AiNurtureSettingVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** B28 养号设置（租户取自 JWT，按租户一份）。A16：读=knowledge:read / 写=knowledge:write。 */
@RestController
@RequestMapping("/api/ai-nurture")
public class AiNurtureController {

    private final AiNurtureSettingService service;

    public AiNurtureController(AiNurtureSettingService service) {
        this.service = service;
    }

    public record NurtureRequest(Integer dailyLimit, Integer activeRatio, String quietHours, String recommend) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<AiNurtureSettingVO> get(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(AiNurtureSettingVO.of(service.getOrCreate(principal.tenantId())));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiNurtureSettingVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @RequestBody NurtureRequest req) {
        return ApiResponse.ok(AiNurtureSettingVO.of(service.update(principal.tenantId(), req.dailyLimit(),
            req.activeRatio(), req.quietHours(), req.recommend())));
    }
}
