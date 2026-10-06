package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.CustomerFollowUp;
import com.smartscrm.server.entity.CustomerLabelChange;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CustomerFollowUpService;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
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
 * B23 客户跟进记录（租户取自 JWT）。A16：读=customerfollow:read 写=customerfollow:write（V46 播种）。
 * v1：跟进记录 CRUD + 标签变更流水只读查询（流水写入由标签写入路径落，见 service 注释）。
 */
@RestController
@RequestMapping("/api/customer-follow-ups")
public class CustomerFollowUpController {

    private final CustomerFollowUpService service;

    public CustomerFollowUpController(CustomerFollowUpService service) {
        this.service = service;
    }

    public record FollowUpRequest(
        Long customerId,
        @NotBlank String content,
        String type,
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime remindAt) {}

    /** 跟进记录列表；带 customerId 只看该客户，不带 = 本租户全部。 */
    @GetMapping
    @PreAuthorize("hasAuthority('customerfollow:read')")
    public ApiResponse<List<CustomerFollowUp>> list(@AuthenticationPrincipal AuthPrincipal p,
                                                    @RequestParam(required = false) Long customerId) {
        return ApiResponse.ok(service.list(p.tenantId(), customerId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('customerfollow:write')")
    public ApiResponse<CustomerFollowUp> create(@AuthenticationPrincipal AuthPrincipal p,
                                                @RequestBody FollowUpRequest r) {
        // AuthPrincipal 不带用户名，操作人记用户 id（够回溯「谁做的」即可）。
        String operator = p.userId() == null ? null : String.valueOf(p.userId());
        return ApiResponse.ok(service.create(p.tenantId(), r.customerId(), r.type(), r.content(),
            r.remindAt(), operator));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('customerfollow:write')")
    public ApiResponse<CustomerFollowUp> update(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id,
                                                @RequestBody FollowUpRequest r) {
        return ApiResponse.ok(service.update(p.tenantId(), id, r.type(), r.content(), r.remindAt()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('customerfollow:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable Long id) {
        service.delete(p.tenantId(), id);
        return ApiResponse.ok(null);
    }

    /** 标签变更流水（只读）；customer_label 撤标即删行，只有这里能回溯「谁在何时打/撤了哪个标签」。 */
    @GetMapping("/label-changes")
    @PreAuthorize("hasAuthority('customerfollow:read')")
    public ApiResponse<List<CustomerLabelChange>> labelChanges(@AuthenticationPrincipal AuthPrincipal p,
                                                               @RequestParam(required = false) Long customerId) {
        return ApiResponse.ok(service.listChanges(p.tenantId(), customerId));
    }
}
