package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.CustomerService;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.web.dto.CustomerCreateRequest;
import com.smartscrm.server.web.dto.CustomerEditRequest;
import com.smartscrm.server.web.dto.CustomerLabelsRequest;
import com.smartscrm.server.web.vo.CustomerTimelineVO;
import com.smartscrm.server.web.vo.CustomerVO;
import jakarta.validation.Valid;
import java.util.List;
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

@RestController
@RequestMapping("/api/customers")
public class CustomerController {

    private final CustomerService service;
    private final MessageQueryService timeline;

    public CustomerController(CustomerService service, MessageQueryService timeline) {
        this.service = service;
        this.timeline = timeline;
    }

    @GetMapping
    public ApiResponse<PageResult<CustomerVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @RequestParam(required = false) String keyword,
                                                    @RequestParam(required = false) Integer platformType,
                                                    @RequestParam(required = false) List<Long> labelIds,
                                                    @RequestParam(required = false) String country,
                                                    @RequestParam(defaultValue = "1") long page,
                                                    @RequestParam(defaultValue = "20") long pageSize) {
        return ApiResponse.ok(
            service.page(principal.tenantId(), keyword, platformType, labelIds, country, page, pageSize));
    }

    @GetMapping("/{id}")
    public ApiResponse<CustomerVO> detail(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        return ApiResponse.ok(service.detail(principal.tenantId(), id));
    }

    @PostMapping
    public ApiResponse<CustomerVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                          @Valid @RequestBody CustomerCreateRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), req));
    }

    /** 时间线消费的是 chat_* 那两张表，实现留在 MessageQueryService，这里只做路由（Task 5）。 */
    @GetMapping("/{id}/timeline")
    public ApiResponse<CustomerTimelineVO> timeline(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable Long id,
                                                    @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(timeline.timeline(principal.tenantId(), id, size));
    }

    @PutMapping("/{id}")
    public ApiResponse<CustomerVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable Long id,
                                          @RequestBody CustomerEditRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), id, req));
    }

    @PutMapping("/{id}/labels")
    public ApiResponse<CustomerVO> setLabels(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable Long id,
                                             @Valid @RequestBody CustomerLabelsRequest req) {
        return ApiResponse.ok(service.setLabels(principal.tenantId(), id, req.labelIds()));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
