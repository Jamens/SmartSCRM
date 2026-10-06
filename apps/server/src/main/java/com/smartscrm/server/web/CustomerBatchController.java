package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CustomerFollowUpService;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * B23 客户批量操作条（租户取自 JWT）。A16：写=customerfollow:write（V46 播种）。
 * 批量打/撤标签：对每个「客户 × 标签」组合幂等处理，并逐条落标签变更流水。
 */
@RestController
@RequestMapping("/api/customer-batch")
public class CustomerBatchController {

    private final CustomerFollowUpService service;

    public CustomerBatchController(CustomerFollowUpService service) {
        this.service = service;
    }

    public record BatchLabelRequest(List<Long> customerIds, List<Long> labelIds, String action) {}

    /**
     * @return 实际发生变更的条数（已挂的再打、没挂的再撤都不计数，故可能小于 客户数×标签数）
     */
    @PostMapping("/label")
    @PreAuthorize("hasAuthority('customerfollow:write')")
    public ApiResponse<Integer> batchLabel(@AuthenticationPrincipal AuthPrincipal p,
                                           @RequestBody BatchLabelRequest r) {
        return ApiResponse.ok(service.batchLabel(p.tenantId(), r.customerIds(), r.labelIds(), r.action()));
    }
}
